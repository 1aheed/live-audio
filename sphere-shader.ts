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

// Smooth noise function
float smoothNoise(vec3 p) {
  return 0.5 * (sin(p.x) + sin(p.y) + sin(p.z));
}

// Elegant wave function
float elegantWave(vec3 pos, float frequency, float amplitude, float timeScale) {
  float wave = sin(pos.x * frequency + time * timeScale) * 
               cos(pos.y * frequency + time * timeScale * 0.7) * 
               sin(pos.z * frequency + time * timeScale * 0.5);
  return amplitude * wave * 0.5;
}

// Beautiful calculation with gentle deformations
vec3 calc(vec3 pos) {
  vec3 dir = normalize(pos);
  float r = length(pos);
  
  // Gentle breathing effect
  float breath = 0.08 * sin(time * 0.8) * (1.0 + 0.3 * sin(r * 2.0));
  
  // Elegant wave layers
  float wave1 = elegantWave(pos, 1.5, 0.12, 1.0);
  float wave2 = elegantWave(pos * 0.7, 2.2, 0.08, 1.5);
  float wave3 = elegantWave(pos * 1.3, 1.8, 0.06, 0.8);
  
  // Subtle spiral motion
  float angle = atan(pos.y, pos.x);
  float spiral = 0.04 * sin(angle * 3.0 + r * 4.0 + time * 1.2);
  
  // Gentle radial pulsing
  float pulse = 0.05 * sin(r * 6.0 - time * 2.0) * exp(-r * 0.3);
  
  // Soft noise texture
  float noise = 0.03 * smoothNoise(pos * 3.0 + vec3(time * 0.2, 0.0, time * 0.15));
  
  // Combine all effects with smooth blending
  float totalDisplacement = breath + wave1 + wave2 + wave3 + spiral + pulse + noise;
  
  // Keep original input/output influence but much gentler
  totalDisplacement += 0.1 * inputData.x * inputData.y * 
                       (0.5 + 0.5 * sin(inputData.z * pos.x + time));
  totalDisplacement += 0.1 * outputData.x * outputData.y * 
                       (0.5 + 0.5 * sin(outputData.z * pos.y + time));
  
  return pos + dir * totalDisplacement;
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
  
  float inc = 0.001;
  float r = length(position);
  float theta = (uv.x + 0.5) * 2.0 * PI;
  float phi = -(uv.y + 0.5) * PI;
  
  vec3 np = calc(spherical(r, theta, phi));
  vec3 tangent = normalize(calc(spherical(r, theta + inc, phi)) - np);
  vec3 bitangent = normalize(calc(spherical(r, theta, phi + inc)) - np);
  
  transformedNormal = -normalMatrix * normalize(cross(tangent, bitangent));
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
