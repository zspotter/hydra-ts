import { Output } from './src/output';
import { Loop } from './src/loop';
import { HydraSource } from './src/hydra-source';
import ArrayUtils from './src/lib/array-utils';
import { EvalSandbox } from './src/eval-sandbox';
import { DrawCommand, Framebuffer, Regl } from 'regl';

import { GeneratorFactory } from './src/generator-factory';

export type Precision = 'lowp' | 'mediump' | 'highp';

type ReglProps = {
  tex0: Framebuffer;
  tex1: Framebuffer;
  tex2: Framebuffer;
  tex3: Framebuffer;
  resolution: [number, number];
};

export interface Synth {
  time: number;
  bpm: number;
  width: number;
  height: number;
  fps?: number;
  stats: {
    fps: number;
  };
  speed: number;
  render: any;
  setResolution: any;
  hush: () => void;
  [name: string]: any;
}

interface HydraRendererOptions {
  width?: HydraRenderer['width'];
  height?: HydraRenderer['height'];
  numSources?: number;
  numOutputs?: number;
  makeGlobal?: boolean;
  autoLoop?: boolean;
  regl: HydraRenderer['regl'];
  precision?: HydraRenderer['precision'];
}

// to do: add ability to pass in certain uniforms and transforms
export class HydraRenderer implements HydraRendererOptions {
  width: number;
  height: number;
  synth: Synth;
  timeSinceLastUpdate;
  _time;
  precision: Precision;
  generator?: GeneratorFactory;
  sandbox: EvalSandbox;
  imageCallback?: (blob: Blob | null) => void;
  regl: Regl;
  // @ts-ignore
  renderFbo: DrawCommand;
  s: HydraSource[] = [];
  o: Output[] = [];
  // @ts-ignore
  output: Output;
  loop: Loop;
  [name: string]: any;

  constructor({
    width = 1280,
    height = 720,
    numSources = 4,
    numOutputs = 4,
    makeGlobal = true,
    autoLoop = true,
    precision = 'mediump',
    regl,
  }: HydraRendererOptions) {
    ArrayUtils.init();

    this.width = width;
    this.height = height;

    this.regl = regl;

    // object that contains all properties that will be made available on the global context and during local evaluation
    this.synth = {
      time: 0,
      bpm: 30,
      width: this.width,
      height: this.height,
      fps: undefined,
      stats: {
        fps: 0,
      },
      speed: 1,
      render: this._render,
      setResolution: this.setResolution,
      hush: this.hush,
    };

    this.timeSinceLastUpdate = 0;
    this._time = 0; // for internal use, only to use for deciding when to render frames

    this.precision = precision;

    this.generator = undefined;

    this._initRegl();
    this._initOutputs(numOutputs);
    this._initSources(numSources);
    this._generateGlslTransforms();

    this.loop = new Loop(this.tick);
    if (autoLoop) {
      this.loop.start();
    }

    // final argument is properties that the user can set, all others are treated as read-only
    this.sandbox = new EvalSandbox(this.synth, makeGlobal, ['speed', 'bpm', 'fps']);
  }

  hush = () => {
    this.s.forEach((source) => {
      source.clear();
    });
    this.o.forEach((output) => {
      this.synth.solid(1, 1, 1, 0).out(output);
    });
  };

  setResolution = (width: number, height: number) => {
    this.regl._gl.canvas.width = width;
    this.regl._gl.canvas.height = height;
    this.width = width;
    this.height = height;
    this.o.forEach((output) => {
      output.resize(width, height);
    });
    this.s.forEach((source) => {
      source.resize(width, height);
    });
    this.regl._refresh();
  };

  _initRegl() {
    // This clears the color buffer to black and the depth buffer to 1
    this.regl.clear({
      color: [0, 0, 0, 1],
    });

    this.renderFbo = this.regl({
      frag: `
      precision ${this.precision} float;
      varying vec2 uv;
      uniform vec2 resolution;
      uniform sampler2D tex0;

      void main () {
        gl_FragColor = texture2D(tex0, vec2(1.0 - uv.x, uv.y));
      }
      `,
      vert: `
      precision ${this.precision} float;
      attribute vec2 position;
      varying vec2 uv;

      void main () {
        uv = position;
        gl_Position = vec4(1.0 - 2.0 * position, 0, 1);
      }`,
      attributes: {
        position: [
          [-2, 0],
          [0, -2],
          [2, 2],
        ],
      },
      uniforms: {
        tex0: this.regl.prop<ReglProps, keyof ReglProps>('tex0'),
        resolution: this.regl.prop<ReglProps, keyof ReglProps>('resolution'),
      },
      count: 3,
      depth: { enable: false },
    });
  }

  _initOutputs(numOutputs: number) {
    const self = this;
    this.o = Array(numOutputs)
      .fill(undefined)
      .map((el, index) => {
        const o = new Output({
          regl: this.regl,
          width: this.width,
          height: this.height,
          precision: this.precision,
        });
        //  o.render()
        o.id = index;
        self.synth['o' + index] = o;
        return o;
      });

    // set default output
    this.output = this.o[0];
  }

  _initSources(numSources: number) {
    this.s = [];
    for (let i = 0; i < numSources; i++) {
      this.createSource(i);
    }
  }

  createSource(i: number) {
    let s = new HydraSource({
      regl: this.regl,
      width: this.width,
      height: this.height,
    });
    this.synth['s' + this.s.length] = s;
    this.s.push(s);
    return s;
  }

  _generateGlslTransforms() {
    const self = this;
    this.generator = new GeneratorFactory({
      defaultOutput: this.o[0],
      defaultUniforms: this.o[0].uniforms,
      changeListener: ({
        type,
        method,
        synth,
      }: {
        type: string;
        method: string;
        synth: GeneratorFactory;
      }) => {
        if (type === 'add') {
          self.synth[method] = synth.generators[method];
          if (self.sandbox) self.sandbox.add(method);
        } else if (type === 'remove') {
          // what to do here? dangerously deleting window methods
          //delete window[method]
        }
        //  }
      },
    });
    this.synth.setFunction = this.generator.setFunction;
  }

  _render = (output: Output) => {
    if (output) {
      this.output = output;
    } else {
      this.output = this.o[0];
    }
  };

  // dt in ms
  tick = (dt: number) => {
    this.sandbox.tick();
    this.sandbox.set('time', (this.synth.time += dt * 0.001 * this.synth.speed));
    this.timeSinceLastUpdate += dt;

    if (!this.synth.fps || this.timeSinceLastUpdate >= 1000 / this.synth.fps) {
      this.synth.stats.fps = Math.ceil(1000 / this.timeSinceLastUpdate);

      this.s.forEach((source) => {
        source.tick(this.synth.time);
      });

      this.o.forEach((output) => {
        output.tick({
          time: this.synth.time,
          bpm: this.synth.bpm,
          resolution: [this.regl._gl.canvas.width, this.regl._gl.canvas.height],
        });
      });

      this.renderFbo({
        tex0: this.output.getCurrent(),
        resolution: [this.regl._gl.canvas.width, this.regl._gl.canvas.height],
      });

      this.timeSinceLastUpdate = 0;
    }
  };
}