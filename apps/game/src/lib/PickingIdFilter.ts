import { Filter, GlProgram, GpuProgram, UniformGroup } from 'pixi.js';

const glVertexShader = `
  in vec2 aPosition;
  out vec2 vTextureCoord;
  
  uniform vec4 uInputSize;
  uniform vec4 uOutputFrame;
  uniform vec4 uOutputTexture;
  
  vec4 filterVertexPosition() {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
  }
  
  vec2 filterTextureCoord() {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
  }
  
  void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
  }
`;

const glFragmentShader = `
  precision highp float;
  in vec2 vTextureCoord;
  out vec4 fragColor;
  
  uniform sampler2D uTexture;
  uniform vec3 customUniforms_uColor;
  
  void main(void) {
    vec4 color = texture(uTexture, vTextureCoord);
    
    if (color.a > 0.0) {
      fragColor = vec4(customUniforms_uColor, 1.0);
    } else {
      fragColor = vec4(0.0, 0.0, 0.0, 0.0);
    }
  }
`;

const wgslShader = `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> customUniforms: CustomUniforms;

struct CustomUniforms {
  uColor: vec3<f32>,
};

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>
};

@vertex
fn mainVertex(
  @location(0) aPosition: vec2<f32>,
) -> VSOutput {
  var output: VSOutput;
  
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  
  output.position = vec4<f32>(position, 0.0, 1.0);
  output.uv = aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
  
  return output;
}

@fragment
fn mainFragment(
  @location(0) uv: vec2<f32>
) -> @location(0) vec4<f32> {
  let color = textureSample(uTexture, uSampler, uv);
  
  if (color.a > 0.0) {
    return vec4<f32>(customUniforms.uColor, 1.0);
  } else {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }
}
`;

export class PickingIdFilter extends Filter {
  constructor(r: number, g: number, b: number) {
    super({
      glProgram: GlProgram.from({
        vertex: glVertexShader,
        fragment: glFragmentShader,
      }),
      gpuProgram: GpuProgram.from({
        vertex: {
          source: wgslShader,
          entryPoint: 'mainVertex',
        },
        fragment: {
          source: wgslShader,
          entryPoint: 'mainFragment',
        },
      }),
      resources: {
        customUniforms: new UniformGroup({
          uColor: { value: [r / 255, g / 255, b / 255], type: 'vec3<f32>' },
        }),
      },
    });
  }
}