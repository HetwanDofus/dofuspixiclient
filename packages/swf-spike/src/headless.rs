//! Headless wgpu+Vello pipeline. Mirrors the existing `dofasset-renderer`
//! main.rs setup so the spike doesn't have to fight backend differences.

use anyhow::{anyhow, Result};
use vello::peniko::Color;
use vello::{wgpu, AaConfig, Renderer, RendererOptions, Scene};

pub struct Headless {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub renderer: Renderer,
}

impl Headless {
    pub async fn new() -> Result<Self> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..Default::default()
        });
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                ..Default::default()
            })
            .await
            .map_err(|e| anyhow!("no GPU adapter: {e:?}"))?;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("swf-spike"),
                required_features: adapter.features()
                    & (wgpu::Features::TIMESTAMP_QUERY | wgpu::Features::CLEAR_TEXTURE),
                required_limits: adapter.limits(),
                ..Default::default()
            })
            .await
            .map_err(|e| anyhow!("device: {e:?}"))?;

        let renderer = Renderer::new(
            &device,
            RendererOptions {
                use_cpu: false,
                antialiasing_support: vello::AaSupport::area_only(),
                num_init_threads: None,
                pipeline_cache: None,
            },
        )
        .map_err(|e| anyhow!("renderer: {e:?}"))?;

        Ok(Self {
            device,
            queue,
            renderer,
        })
    }

    pub fn render_to_pixels(
        &mut self,
        scene: &Scene,
        w: u32,
        h: u32,
        bg: Color,
    ) -> Result<Vec<u8>> {
        let tex = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("render_target"),
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = tex.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: bg,
            width: w,
            height: h,
            antialiasing_method: AaConfig::Area,
        };
        self.renderer
            .render_to_texture(&self.device, &self.queue, scene, &view, &params)
            .map_err(|e| anyhow!("render: {e:?}"))?;

        let bpr = (w * 4 + 255) & !255;
        let buf = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: (bpr * h) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut enc = self
            .device
            .create_command_encoder(&Default::default());
        enc.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &tex,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &buf,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(bpr),
                    rows_per_image: None,
                },
            },
            wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit(Some(enc.finish()));

        let slice = buf.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |r| {
            tx.send(r).unwrap();
        });
        self.device
            .poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: None,
            })
            .ok();
        rx.recv().unwrap().map_err(|e| anyhow!("map: {e:?}"))?;

        let data = slice.get_mapped_range();
        let mut pixels = vec![0u8; (w * h * 4) as usize];
        for row in 0..h {
            let src_start = (row * bpr) as usize;
            let dst_start = (row * w * 4) as usize;
            let row_bytes = (w * 4) as usize;
            pixels[dst_start..dst_start + row_bytes]
                .copy_from_slice(&data[src_start..src_start + row_bytes]);
        }
        drop(data);
        buf.unmap();

        // Vello stores premultiplied alpha; PNG expects un-premultiplied.
        for chunk in pixels.chunks_exact_mut(4) {
            let a = f32::from(chunk[3]) / 255.0;
            if a > 0.0 {
                chunk[0] = (f32::from(chunk[0]) / a).min(255.0) as u8;
                chunk[1] = (f32::from(chunk[1]) / a).min(255.0) as u8;
                chunk[2] = (f32::from(chunk[2]) / a).min(255.0) as u8;
            }
        }
        Ok(pixels)
    }
}
