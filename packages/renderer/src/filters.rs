//! GPU compute shader implementations for SVG filter primitives.
//!
//! Supports: feGaussianBlur, feConvolveMatrix (box blur), feColorMatrix.
//! Filters are applied as post-processing passes on intermediate textures.

use wgpu;
use wgpu::util::DeviceExt;

// ---------------------------------------------------------------------------
// WGSL Shader Sources
// ---------------------------------------------------------------------------

const BLUR_SHADER: &str = r#"
struct Params {
    radius: i32,
    sigma: f32,
    width: u32,
    height: u32,
    direction: u32, // 0 = horizontal, 1 = vertical
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
}

@group(0) @binding(0) var input_tex: texture_2d<f32>;
@group(0) @binding(1) var output_tex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: Params;

fn gaussian_weight(x: f32, sigma: f32) -> f32 {
    return exp(-(x * x) / (2.0 * sigma * sigma));
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    let w = i32(params.width);
    let h = i32(params.height);
    if (x >= w || y >= h) { return; }

    var sum = vec4<f32>(0.0);
    var weight_sum: f32 = 0.0;
    let r = params.radius;

    for (var i = -r; i <= r; i++) {
        let weight = gaussian_weight(f32(i), params.sigma);
        var sx: i32;
        var sy: i32;
        if (params.direction == 0u) {
            sx = clamp(x + i, 0, w - 1);
            sy = y;
        } else {
            sx = x;
            sy = clamp(y + i, 0, h - 1);
        }
        let pixel = textureLoad(input_tex, vec2<i32>(sx, sy), 0);
        sum += pixel * weight;
        weight_sum += weight;
    }

    let result = sum / weight_sum;
    textureStore(output_tex, vec2<i32>(x, y), result);
}
"#;

const CONVOLVE_SHADER: &str = r#"
struct Params {
    columns: u32,
    rows: u32,
    target_x: u32,
    target_y: u32,
    divisor: f32,
    bias: f32,
    width: u32,
    height: u32,
    preserve_alpha: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
}

@group(0) @binding(0) var input_tex: texture_2d<f32>;
@group(0) @binding(1) var output_tex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<storage, read> kernel: array<f32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    let w = i32(params.width);
    let h = i32(params.height);
    if (x >= w || y >= h) { return; }

    var sum = vec4<f32>(0.0);
    let cols = i32(params.columns);
    let rows = i32(params.rows);
    let tx = i32(params.target_x);
    let ty = i32(params.target_y);

    for (var ky = 0; ky < rows; ky++) {
        for (var kx = 0; kx < cols; kx++) {
            let sx = clamp(x + kx - tx, 0, w - 1);
            let sy = clamp(y + ky - ty, 0, h - 1);
            let k = kernel[ky * cols + kx];
            let pixel = textureLoad(input_tex, vec2<i32>(sx, sy), 0);
            sum += pixel * k;
        }
    }

    var result = sum / params.divisor + params.bias;
    result = clamp(result, vec4<f32>(0.0), vec4<f32>(1.0));

    if (params.preserve_alpha != 0u) {
        let orig = textureLoad(input_tex, vec2<i32>(x, y), 0);
        result.a = orig.a;
    }

    textureStore(output_tex, vec2<i32>(x, y), result);
}
"#;

const COLOR_MATRIX_SHADER: &str = r#"
struct Params {
    matrix: array<vec4<f32>, 5>, // 5x4 matrix stored as 5 rows of 4 floats
    width: u32,
    height: u32,
    _pad0: u32,
    _pad1: u32,
}

@group(0) @binding(0) var input_tex: texture_2d<f32>;
@group(0) @binding(1) var output_tex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    if (x >= i32(params.width) || y >= i32(params.height)) { return; }

    let pixel = textureLoad(input_tex, vec2<i32>(x, y), 0);
    // SVG feColorMatrix: [R',G',B',A'] = M * [R,G,B,A,1]
    // Matrix is 4 rows x 5 columns, stored as 5 columns of 4 rows
    let src = vec4<f32>(pixel.r, pixel.g, pixel.b, pixel.a);
    let r_new = dot(params.matrix[0], src) + params.matrix[4].x;
    let g_new = dot(params.matrix[1], src) + params.matrix[4].y;
    let b_new = dot(params.matrix[2], src) + params.matrix[4].z;
    let a_new = dot(params.matrix[3], src) + params.matrix[4].w;

    let result = clamp(vec4<f32>(r_new, g_new, b_new, a_new), vec4<f32>(0.0), vec4<f32>(1.0));
    textureStore(output_tex, vec2<i32>(x, y), result);
}
"#;

// ---------------------------------------------------------------------------
// Pipeline cache
// ---------------------------------------------------------------------------

pub struct FilterPipelines {
    blur_pipeline: wgpu::ComputePipeline,
    blur_bind_group_layout: wgpu::BindGroupLayout,
    convolve_pipeline: wgpu::ComputePipeline,
    convolve_bind_group_layout: wgpu::BindGroupLayout,
    color_matrix_pipeline: wgpu::ComputePipeline,
    color_matrix_bind_group_layout: wgpu::BindGroupLayout,
}

impl FilterPipelines {
    pub fn new(device: &wgpu::Device) -> Self {
        // Blur pipeline
        let blur_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("blur_shader"),
            source: wgpu::ShaderSource::Wgsl(BLUR_SHADER.into()),
        });
        let blur_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("blur_bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let blur_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("blur_layout"),
            bind_group_layouts: &[&blur_bind_group_layout],
            push_constant_ranges: &[],
        });
        let blur_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("blur_pipeline"),
            layout: Some(&blur_pipeline_layout),
            module: &blur_shader,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });

        // Convolve pipeline (needs an extra storage buffer for kernel data)
        let convolve_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("convolve_shader"),
            source: wgpu::ShaderSource::Wgsl(CONVOLVE_SHADER.into()),
        });
        let convolve_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("convolve_bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let convolve_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("convolve_layout"),
            bind_group_layouts: &[&convolve_bind_group_layout],
            push_constant_ranges: &[],
        });
        let convolve_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("convolve_pipeline"),
            layout: Some(&convolve_pipeline_layout),
            module: &convolve_shader,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });

        // Color matrix pipeline
        let cm_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("color_matrix_shader"),
            source: wgpu::ShaderSource::Wgsl(COLOR_MATRIX_SHADER.into()),
        });
        let color_matrix_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("color_matrix_bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let cm_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("color_matrix_layout"),
            bind_group_layouts: &[&color_matrix_bind_group_layout],
            push_constant_ranges: &[],
        });
        let color_matrix_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("color_matrix_pipeline"),
            layout: Some(&cm_pipeline_layout),
            module: &cm_shader,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });

        Self {
            blur_pipeline,
            blur_bind_group_layout,
            convolve_pipeline,
            convolve_bind_group_layout,
            color_matrix_pipeline,
            color_matrix_bind_group_layout,
        }
    }

    /// Apply Gaussian blur (separable 2-pass: horizontal then vertical).
    pub fn apply_gaussian_blur(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        input: &wgpu::Texture,
        w: u32,
        h: u32,
        std_dev_x: f32,
        std_dev_y: f32,
    ) -> wgpu::Texture {
        let mut current = self.blur_pass(device, queue, input, w, h, std_dev_x, 0); // horizontal
        let result = self.blur_pass(device, queue, &current, w, h, std_dev_y, 1); // vertical
        result
    }

    fn blur_pass(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        input: &wgpu::Texture,
        w: u32,
        h: u32,
        sigma: f32,
        direction: u32,
    ) -> wgpu::Texture {
        let radius = (sigma * 3.0).ceil() as i32;
        if radius == 0 { return self.copy_texture(device, queue, input, w, h); }

        let output = create_storage_texture(device, w, h);

        #[repr(C)]
        #[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
        struct Params {
            radius: i32,
            sigma: f32,
            width: u32,
            height: u32,
            direction: u32,
            _pad: [u32; 3],
        }

        let params_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("blur_params"),
            contents: bytemuck::bytes_of(&Params {
                radius,
                sigma,
                width: w,
                height: h,
                direction,
                _pad: [0; 3],
            }),
            usage: wgpu::BufferUsages::UNIFORM,
        });

        let input_view = input.create_view(&wgpu::TextureViewDescriptor::default());
        let output_view = output.create_view(&wgpu::TextureViewDescriptor::default());

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("blur_bg"),
            layout: &self.blur_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&input_view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&output_view) },
                wgpu::BindGroupEntry { binding: 2, resource: params_buf.as_entire_binding() },
            ],
        });

        let mut encoder = device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(&self.blur_pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.dispatch_workgroups((w + 15) / 16, (h + 15) / 16, 1);
        }
        queue.submit(Some(encoder.finish()));

        output
    }

    /// Apply convolution matrix filter.
    pub fn apply_convolve_matrix(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        input: &wgpu::Texture,
        w: u32,
        h: u32,
        kernel_data: &[f32],
        columns: u32,
        rows: u32,
        target_x: u32,
        target_y: u32,
        divisor: f32,
        bias: f32,
        preserve_alpha: bool,
    ) -> wgpu::Texture {
        let output = create_storage_texture(device, w, h);

        #[repr(C)]
        #[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
        struct Params {
            columns: u32,
            rows: u32,
            target_x: u32,
            target_y: u32,
            divisor: f32,
            bias: f32,
            width: u32,
            height: u32,
            preserve_alpha: u32,
            _pad: [u32; 3],
        }

        let params_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("convolve_params"),
            contents: bytemuck::bytes_of(&Params {
                columns, rows, target_x, target_y,
                divisor, bias, width: w, height: h,
                preserve_alpha: if preserve_alpha { 1 } else { 0 },
                _pad: [0; 3],
            }),
            usage: wgpu::BufferUsages::UNIFORM,
        });

        let kernel_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("kernel"),
            contents: bytemuck::cast_slice(kernel_data),
            usage: wgpu::BufferUsages::STORAGE,
        });

        let input_view = input.create_view(&wgpu::TextureViewDescriptor::default());
        let output_view = output.create_view(&wgpu::TextureViewDescriptor::default());

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("convolve_bg"),
            layout: &self.convolve_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&input_view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&output_view) },
                wgpu::BindGroupEntry { binding: 2, resource: params_buf.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 3, resource: kernel_buf.as_entire_binding() },
            ],
        });

        let mut encoder = device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(&self.convolve_pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.dispatch_workgroups((w + 15) / 16, (h + 15) / 16, 1);
        }
        queue.submit(Some(encoder.finish()));

        output
    }

    /// Apply color matrix filter.
    pub fn apply_color_matrix(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        input: &wgpu::Texture,
        w: u32,
        h: u32,
        matrix: &[f32; 20],
    ) -> wgpu::Texture {
        let output = create_storage_texture(device, w, h);

        // Rearrange from SVG row-major 4x5 to shader-friendly 5 vec4s
        // SVG: [m00 m01 m02 m03 m04  m10 m11 m12 m13 m14  m20 m21 m22 m23 m24  m30 m31 m32 m33 m34]
        // Shader: col0=[m00,m10,m20,m30] col1=[m01,m11,m21,m31] ... col4=[m04,m14,m24,m34]
        let mut shader_matrix = [0.0f32; 20];
        for row in 0..4 {
            for col in 0..5 {
                shader_matrix[col * 4 + row] = matrix[row * 5 + col];
            }
        }
        // Plus width/height after the matrix
        #[repr(C)]
        #[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
        struct Params {
            matrix: [f32; 20],
            width: u32,
            height: u32,
            _pad: [u32; 2],
        }

        let params_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("color_matrix_params"),
            contents: bytemuck::bytes_of(&Params {
                matrix: shader_matrix,
                width: w,
                height: h,
                _pad: [0; 2],
            }),
            usage: wgpu::BufferUsages::UNIFORM,
        });

        let input_view = input.create_view(&wgpu::TextureViewDescriptor::default());
        let output_view = output.create_view(&wgpu::TextureViewDescriptor::default());

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("color_matrix_bg"),
            layout: &self.color_matrix_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&input_view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&output_view) },
                wgpu::BindGroupEntry { binding: 2, resource: params_buf.as_entire_binding() },
            ],
        });

        let mut encoder = device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(&self.color_matrix_pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.dispatch_workgroups((w + 15) / 16, (h + 15) / 16, 1);
        }
        queue.submit(Some(encoder.finish()));

        output
    }

    fn copy_texture(&self, device: &wgpu::Device, queue: &wgpu::Queue, src: &wgpu::Texture, w: u32, h: u32) -> wgpu::Texture {
        let dst = create_storage_texture(device, w, h);
        let mut encoder = device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_texture(
            src.as_image_copy(),
            dst.as_image_copy(),
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        queue.submit(Some(encoder.finish()));
        dst
    }
}

/// Create a texture suitable for compute shader storage (read + write).
fn create_storage_texture(device: &wgpu::Device, w: u32, h: u32) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("filter_tex"),
        size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::STORAGE_BINDING
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC
            | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    })
}
