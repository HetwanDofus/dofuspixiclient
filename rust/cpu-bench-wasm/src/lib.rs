//! Browser harness for the vello_cpu bench. `BenchPool` mirrors what a
//! production CPU bake worker would hold — parsed class + accessory
//! bundles — so per-task timings measure bake cost, not SWF parsing.
//! Rows are JSON with the same fields as the native CLI table.

use std::collections::HashMap;

use wasm_bindgen::prelude::*;

use cpu_bench::bench::{bench_variant, pick_accessories, pick_export};
use swf_spike::render::set_record_fragments;
use swf_spike::swf_doc::SwfDoc;

/// Rasterizer worker threads. vello_cpu's multithreading feature builds a
/// private rayon pool + blocking channel recv — neither works on wasm —
/// so the only in-render config is single-threaded (0). Parallelism comes
/// from sharding bakes across web workers instead.
const WASM_THREADS: [u16; 1] = [0];

#[wasm_bindgen]
pub struct BenchPool {
    classes: HashMap<u32, SwfDoc>,
    acc_docs: Vec<SwfDoc>,
}

#[wasm_bindgen]
impl BenchPool {
    #[wasm_bindgen(constructor)]
    pub fn new() -> BenchPool {
        console_error_panic_hook::set_once();
        set_record_fragments(true);

        BenchPool {
            classes: HashMap::new(),
            acc_docs: Vec::new(),
        }
    }

    #[wasm_bindgen(js_name = "loadClass")]
    pub fn load_class(&mut self, id: u32, bytes: &[u8]) -> Result<(), JsValue> {
        let doc = SwfDoc::from_bytes(bytes).map_err(|e| JsValue::from_str(&format!("{e:#}")))?;
        self.classes.insert(id, doc);

        Ok(())
    }

    #[wasm_bindgen(js_name = "loadAccBundle")]
    pub fn load_acc_bundle(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
        let doc = SwfDoc::from_bytes(bytes).map_err(|e| JsValue::from_str(&format!("{e:#}")))?;
        self.acc_docs.push(doc);

        Ok(())
    }

    /// Bench one (class, zoom) variant; `composed` mounts the picked
    /// hat+cape+shield. Returns a JSON row.
    #[wasm_bindgen(js_name = "benchOne")]
    pub fn bench_one(
        &self,
        class: u32,
        zoom: f64,
        composed: bool,
        reps: usize,
    ) -> Result<String, JsValue> {
        let doc = self
            .classes
            .get(&class)
            .ok_or_else(|| JsValue::from_str("class not loaded"))?;
        let export =
            pick_export(doc).ok_or_else(|| JsValue::from_str("no character-anim export"))?;
        let accs = if composed {
            pick_accessories(&self.acc_docs)
        } else {
            Vec::new()
        };

        let b = bench_variant(doc, &export, &accs, zoom, &WASM_THREADS, reps)
            .ok_or_else(|| JsValue::from_str("bench failed"))?;
        let (_, replay_ms, raster_ms) = b.timings[0];

        Ok(format!(
            concat!(
                "{{\"class\":{},\"export\":\"{}\",\"acc\":\"{}\",\"frames\":{},\"zoom\":{},",
                "\"w\":{},\"h\":{},\"ops\":{},\"lossy\":{},\"walkColdMs\":{:.3},",
                "\"walkWarmMs\":{:.3},\"replayMs\":{:.3},\"rasterMs\":{:.3},\"perFrameMs\":{:.4}}}"
            ),
            class,
            b.export,
            b.acc_labels,
            b.frames,
            b.zoom,
            b.width,
            b.height,
            b.ops,
            b.lossy,
            b.walk_cold_ms,
            b.walk_warm_ms,
            replay_ms,
            raster_ms,
            b.per_frame_ms(0),
        ))
    }
}

impl Default for BenchPool {
    fn default() -> Self {
        Self::new()
    }
}

/// The fearless_simd level `RenderSettings::default()` will run at —
/// "WasmSimd128(..)" when the module was compiled with
/// `-C target-feature=+simd128` (the workspace default), "Fallback(..)"
/// otherwise.
#[wasm_bindgen(js_name = "simdLevel")]
pub fn simd_level() -> String {
    format!("{:?}", vello_cpu::RenderSettings::default().level)
}
