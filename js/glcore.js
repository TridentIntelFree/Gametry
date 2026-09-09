// Minimal WebGL2 helpers: programs, fullscreen quad, float render targets.

// Uniforms declared `int` in GLSL. Everything else is uploaded as float —
// inferring from the JS value breaks the moment a float lands on a round number.
const INT_UNIFORMS = new Set(['uMode', 'uPalette']);

export class GLCore {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true, // needed so capture can read the canvas back
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.canvas = canvas;

    // Half-float render targets are what let accumulation hold more than 8 bits
    // per channel. Without them the temporal average bands badly in shadows.
    this.floatLinear =
      !!gl.getExtension('EXT_color_buffer_float') ||
      !!gl.getExtension('EXT_color_buffer_half_float');
    this.accumFormat = this.floatLinear ? gl.RGBA16F : gl.RGBA8;
    this.accumType = this.floatLinear ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

    // fullscreen triangle
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  }

  program(vertSrc, fragSrc, name = 'program') {
    const gl = this.gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(`${name} ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader: ${gl.getShaderInfoLog(sh)}`);
      }
      return sh;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vertSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`${name} link: ${gl.getProgramInfoLog(p)}`);
    }

    // cache uniform locations up front
    const uniforms = {};
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i);
      uniforms[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { handle: p, uniforms };
  }

  texture(width, height, internalFormat, type, filter) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const fmt = internalFormat === gl.RGBA16F ? gl.RGBA : gl.RGBA;
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, fmt, type, null);
    const f = filter || gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  // A render target plus its texture. `accum` targets use the widest format
  // the device supports; others are plain RGBA8.
  target(width, height, kind = 'accum') {
    const gl = this.gl;
    const internal = kind === 'accum' ? this.accumFormat : gl.RGBA8;
    const type = kind === 'accum' ? this.accumType : gl.UNSIGNED_BYTE;
    const tex = this.texture(width, height, internal, type);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) throw new Error('incomplete framebuffer');
    return { tex, fbo, width, height };
  }

  videoTexture() {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  uploadVideo(tex, video) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  // Bind a program, its textures and uniforms, then draw the fullscreen triangle.
  draw(program, target, textures, uniforms) {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.width, target.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    gl.useProgram(program.handle);

    let unit = 0;
    for (const [name, tex] of Object.entries(textures || {})) {
      const loc = program.uniforms[name];
      if (loc == null) continue;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc, unit);
      unit++;
    }

    for (const [name, value] of Object.entries(uniforms || {})) {
      const loc = program.uniforms[name];
      if (loc == null) continue;
      if (Array.isArray(value)) {
        if (value.length === 2) gl.uniform2f(loc, value[0], value[1]);
        else if (value.length === 3) gl.uniform3f(loc, value[0], value[1], value[2]);
      } else if (INT_UNIFORMS.has(name)) {
        gl.uniform1i(loc, value | 0);
      } else {
        gl.uniform1f(loc, value);
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
