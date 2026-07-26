/**
 * Shared glow-particle GLSL. Renders each point as a soft, round, additive
 * glow that lerps between a primary and secondary color. Used by the cute
 * constellations and the ambient particle field.
 *
 * Kept as exported strings (rather than .glsl files) to avoid adding a
 * GLSL import loader to the build.
 */
export const glowParticleVertexShader = /* glsl */ `
  attribute float size;
  attribute float aSeed;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uTwinkle;

  varying float vSeed;

  void main() {
    vSeed = aSeed;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // Gentle per-point twinkle in size.
    float tw = 1.0 + sin(uTime * 1.5 + aSeed * 6.2831) * uTwinkle;
    // Nearby shell particles can pass close to the camera, so protect the
    // perspective divisor from approaching zero. This keeps foreground dust
    // from becoming a screen-sized additive disc.
    float safeDepth = max(8.0, -mvPosition.z);
    gl_PointSize = size * uPixelRatio * tw * (60.0 / safeDepth);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const glowParticleFragmentShader = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;

  varying float vSeed;

  void main() {
    // Soft circular falloff: distance from the point center.
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    if (d > 0.5) discard;

    // Smooth glow: bright core, soft edge.
    float alpha = smoothstep(0.5, 0.0, d);
    alpha = pow(alpha, 1.6);

    // Mix between the two colors per-particle for variety.
    vec3 col = mix(uColorA, uColorB, fract(vSeed * 0.5 + 0.3));
    gl_FragColor = vec4(col, alpha);
  }
`;
