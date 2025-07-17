/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
const vs = `#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
  varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

uniform float time;
uniform vec4 inputData;
uniform vec4 outputData;

// Noise function for organic patterns
float noise(vec3 p) {
  return sin(p.x * 1.2) * sin(p.y * 1.3) * sin(p.z * 1.1);
}

// Fractal noise for complex patterns
float fractalNoise(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  
  for(int i = 0; i < 4; i++) {
    value += amplitude * noise(p * frequency);
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value;
}

// Enhanced calculation with multiple animation layers
vec3 calc(vec3 pos) {
  vec3 dir = normalize(pos);
  float r = length(pos);
  
  // Time-based variations
  float slowTime = time * 0.5;
  float fastTime = time * 2.0;
  
  // Layer 1: Breathing/pulsing effect
  float pulse = 0.3 * sin(slowTime * 0.8) * (1.0 + 0.5 * sin(r * 3.0 + time));
  
  // Layer 2: Ripple waves emanating from poles
  float ripple1 = 0.4 * sin(r * 8.0 - fastTime * 3.0) * exp(-r * 0.5);
  float ripple2 = 0.3 * sin(r * 12.0 - fastTime * 2.0 + PI) * exp(-r * 0.3);
  
  // Layer 3: Spiral pattern
  float spiral = 0.2 * sin(atan(pos.y, pos.x) * 6.0 + r * 4.0 - time * 1.5);
  
  // Layer 4: Fractal noise for organic texture
  vec3 noisePos = pos + vec3(slowTime * 0.1, 0.0, slowTime * 0.15);
  float organic = 0.15 * fractalNoise(noisePos * 2.0);
  
  // Layer 5: Vertical waves with phase shift
  float verticalWave = 0.25 * sin(pos.z * 6.0 + time * 1.2) * 
                       sin(pos.x * 4.0 + time * 0.8) * 
                       cos(pos.y * 5.0 + time * 1.0);
  
  // Layer 6: Magnetic field-like distortion
  float magnetic = 0.2 * sin(length(pos.xy) * 10.0 + time * 2.5) * 
                   cos(pos.z * 8.0 + time * 1.8);
  
  // Combine all layers with dynamic weighting
  float intensity = 0.7 + 0.3 * sin(time * 0.6);
  
  vec3 displacement = dir * intensity * (
    pulse + 
    ripple1 + ripple2 + 
    spiral + 
    organic + 
    verticalWave + 
    magnetic
  );
  
  // Add original input/output data influence but reduced
  displacement += 0.3 * inputData.x * inputData.y * dir * 
                  (0.5 + 0.5 * sin(inputData.z * pos.x + time));
  displacement += 0.3 * outputData.x * outputData.y * dir * 
                  (0.5 + 0.5 * sin(outputData.z * pos.y + time));
  
  return pos + displacement;
}

vec3 spherical(float r, float theta, float phi) {
  return r * vec3(
    cos(theta) * cos(phi),
    sin(theta) * cos(phi),
    sin(phi)
  );
}

void main() {
  #include <uv_vertex>
  #include <color_vertex>
  #include <morphinstance_vertex>
  #include <morphcolor_vertex>
  #include <batching_vertex>
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <normal_vertex>
  #include <begin_vertex>
  
  // Higher resolution for smoother normals
  float inc = 0.0005;
  float r = length(position);
  float theta = (uv.x + 0.5) * 2.0 * PI;
  float phi = -(uv.y + 0.5) * PI;
  
  // Calculate deformed position
  vec3 np = calc(spherical(r, theta, phi));
  
  // Calculate smooth normals using finite differences
  vec3 tangent = normalize(calc(spherical(r, theta + inc, phi)) - np);
  vec3 bitangent = normalize(calc(spherical(r, theta, phi + inc)) - np);
  
  // Enhanced normal calculation for better lighting
  vec3 normal = normalize(cross(tangent, bitangent));
  transformedNormal = -normalMatrix * normal;
  vNormal = normalize(transformedNormal);
  
  transformed = np;
  
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <displacementmap_vertex>
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>
  
  vViewPosition = -mvPosition.xyz;
  
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>
  
  #ifdef USE_TRANSMISSION
    vWorldPosition = worldPosition.xyz;
  #endif
}`;

export {vs};
