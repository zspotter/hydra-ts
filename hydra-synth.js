"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const output_1 = __importDefault(require("./src/output"));
const raf_loop_1 = __importDefault(require("raf-loop"));
const hydra_source_1 = __importDefault(require("./src/hydra-source"));
const mouse_1 = __importDefault(require("./src/lib/mouse"));
const Mouse = (0, mouse_1.default)();
const audio_1 = __importDefault(require("./src/lib/audio"));
const video_recorder_1 = __importDefault(require("./src/lib/video-recorder"));
const array_utils_1 = __importDefault(require("./src/lib/array-utils"));
const eval_sandbox_1 = __importDefault(require("./src/eval-sandbox"));
const regl_1 = __importDefault(require("regl"));
const generator_factory_1 = __importDefault(require("./src/generator-factory"));
// to do: add ability to pass in certain uniforms and transforms
class HydraRenderer {
    constructor({ pb = null, width = 1280, height = 720, numSources = 4, numOutputs = 4, makeGlobal = true, autoLoop = true, detectAudio = true, enableStreamCapture = true, canvas, precision, extendTransforms = {}, // add your own functions on init
     } = {}) {
        array_utils_1.default.init();
        this.pb = pb;
        this.width = width;
        this.height = height;
        this.renderAll = false;
        this.detectAudio = detectAudio;
        this._initCanvas(canvas);
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
            mouse: Mouse,
            render: this._render.bind(this),
            setResolution: this.setResolution.bind(this),
            update: () => { },
            hush: this.hush.bind(this),
        };
        this.timeSinceLastUpdate = 0;
        this._time = 0; // for internal use, only to use for deciding when to render frames
        // only allow valid precision options
        let precisionOptions = ['lowp', 'mediump', 'highp'];
        if (precision && precisionOptions.includes(precision.toLowerCase())) {
            this.precision = precision.toLowerCase();
            //
            // if(!precisionValid){
            //   console.warn('[hydra-synth warning]\nConstructor was provided an invalid floating point precision value of "' + precision + '". Using default value of "mediump" instead.')
            // }
        }
        else {
            let isIOS = (/iPad|iPhone|iPod/.test(navigator.platform) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) &&
                !window.MSStream;
            this.precision = isIOS ? 'highp' : 'mediump';
        }
        this.extendTransforms = extendTransforms;
        // boolean to store when to save screenshot
        this.saveFrame = false;
        // if stream capture is enabled, this object contains the capture stream
        this.captureStream = null;
        this.generator = undefined;
        this._initRegl();
        this._initOutputs(numOutputs);
        this._initSources(numSources);
        this._generateGlslTransforms();
        this.synth.screencap = () => {
            this.saveFrame = true;
        };
        if (enableStreamCapture) {
            try {
                this.captureStream = this.canvas.captureStream(25);
                // to do: enable capture stream of specific sources and outputs
                this.synth.vidRecorder = new video_recorder_1.default(this.captureStream);
            }
            catch (e) {
                console.warn('[hydra-synth warning]\nnew MediaSource() is not currently supported on iOS.');
                console.error(e);
            }
        }
        if (detectAudio)
            this._initAudio();
        if (autoLoop)
            (0, raf_loop_1.default)(this.tick.bind(this)).start();
        // final argument is properties that the user can set, all others are treated as read-only
        this.sandbox = new eval_sandbox_1.default(this.synth, makeGlobal, ['speed', 'update', 'bpm', 'fps']);
    }
    eval(code) {
        this.sandbox.eval(code);
    }
    getScreenImage(callback) {
        this.imageCallback = callback;
        this.saveFrame = true;
    }
    hush() {
        this.s.forEach((source) => {
            source.clear();
        });
        this.o.forEach((output) => {
            this.synth.solid(1, 1, 1, 0).out(output);
        });
    }
    setResolution(width, height) {
        //  console.log(width, height)
        this.canvas.width = width;
        this.canvas.height = height;
        this.width = width;
        this.height = height;
        this.o.forEach((output) => {
            output.resize(width, height);
        });
        this.s.forEach((source) => {
            source.resize(width, height);
        });
        this.regl._refresh();
        console.log(this.canvas.width);
    }
    canvasToImage() {
        const a = document.createElement('a');
        a.style.display = 'none';
        let d = new Date();
        a.download = `hydra-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}.${d.getMinutes()}.${d.getSeconds()}.png`;
        document.body.appendChild(a);
        var self = this;
        this.canvas.toBlob((blob) => {
            if (self.imageCallback) {
                self.imageCallback(blob);
                delete self.imageCallback;
            }
            else {
                a.href = URL.createObjectURL(blob);
                console.log(a.href);
                a.click();
            }
        }, 'image/png');
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(a.href);
        }, 300);
    }
    _initAudio() {
        // eslint-disable-next-line no-unused-vars
        const that = this;
        this.synth.a = new audio_1.default({
            numBins: 4,
            // changeListener: ({audio}) => {
            //   that.a = audio.bins.map((_, index) =>
            //     (scale = 1, offset = 0) => () => (audio.fft[index] * scale + offset)
            //   )
            //
            //   if (that.makeGlobal) {
            //     that.a.forEach((a, index) => {
            //       const aname = `a${index}`
            //       window[aname] = a
            //     })
            //   }
            // }
        });
    }
    // create main output canvas and add to screen
    _initCanvas(canvas) {
        if (canvas) {
            this.canvas = canvas;
            this.width = canvas.width;
            this.height = canvas.height;
        }
        else {
            this.canvas = document.createElement('canvas');
            this.canvas.width = this.width;
            this.canvas.height = this.height;
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.imageRendering = 'pixelated';
            document.body.appendChild(this.canvas);
        }
    }
    _initRegl() {
        this.regl = (0, regl_1.default)({
            //  profile: true,
            canvas: this.canvas,
            pixelRatio: 1, //,
            // extensions: [
            //   'oes_texture_half_float',
            //   'oes_texture_half_float_linear'
            // ],
            // optionalExtensions: [
            //   'oes_texture_float',
            //   'oes_texture_float_linear'
            //]
        });
        // This clears the color buffer to black and the depth buffer to 1
        this.regl.clear({
            color: [0, 0, 0, 1],
        });
        this.renderAll = this.regl({
            frag: `
      precision ${this.precision} float;
      varying vec2 uv;
      uniform sampler2D tex0;
      uniform sampler2D tex1;
      uniform sampler2D tex2;
      uniform sampler2D tex3;

      void main () {
        vec2 st = vec2(1.0 - uv.x, uv.y);
        st*= vec2(2);
        vec2 q = floor(st).xy*(vec2(2.0, 1.0));
        int quad = int(q.x) + int(q.y);
        st.x += step(1., mod(st.y,2.0));
        st.y += step(1., mod(st.x,2.0));
        st = fract(st);
        if(quad==0){
          gl_FragColor = texture2D(tex0, st);
        } else if(quad==1){
          gl_FragColor = texture2D(tex1, st);
        } else if (quad==2){
          gl_FragColor = texture2D(tex2, st);
        } else {
          gl_FragColor = texture2D(tex3, st);
        }

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
                tex0: this.regl.prop('tex0'),
                tex1: this.regl.prop('tex1'),
                tex2: this.regl.prop('tex2'),
                tex3: this.regl.prop('tex3'),
            },
            count: 3,
            depth: { enable: false },
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
                tex0: this.regl.prop('tex0'),
                resolution: this.regl.prop('resolution'),
            },
            count: 3,
            depth: { enable: false },
        });
    }
    _initOutputs(numOutputs) {
        const self = this;
        this.o = Array(numOutputs)
            .fill()
            .map((el, index) => {
            var o = new output_1.default({
                regl: this.regl,
                width: this.width,
                height: this.height,
                precision: this.precision,
                label: `o${index}`,
            });
            //  o.render()
            o.id = index;
            self.synth['o' + index] = o;
            return o;
        });
        // set default output
        this.output = this.o[0];
    }
    _initSources(numSources) {
        this.s = [];
        for (var i = 0; i < numSources; i++) {
            this.createSource(i);
        }
    }
    createSource(i) {
        let s = new hydra_source_1.default({
            regl: this.regl,
            pb: this.pb,
            width: this.width,
            height: this.height,
            label: `s${i}`,
        });
        this.synth['s' + this.s.length] = s;
        this.s.push(s);
        return s;
    }
    _generateGlslTransforms() {
        var self = this;
        this.generator = new generator_factory_1.default({
            defaultOutput: this.o[0],
            defaultUniforms: this.o[0].uniforms,
            extendTransforms: this.extendTransforms,
            changeListener: ({ type, method, synth }) => {
                if (type === 'add') {
                    self.synth[method] = synth.generators[method];
                    if (self.sandbox)
                        self.sandbox.add(method);
                }
                else if (type === 'remove') {
                    // what to do here? dangerously deleting window methods
                    //delete window[method]
                }
                //  }
            },
        });
        this.synth.setFunction = this.generator.setFunction.bind(this.generator);
    }
    _render(output) {
        if (output) {
            this.output = output;
            this.isRenderingAll = false;
        }
        else {
            this.isRenderingAll = true;
        }
    }
    // dt in ms
    tick(dt) {
        this.sandbox.tick();
        if (this.detectAudio === true)
            this.synth.a.tick();
        //  let updateInterval = 1000/this.synth.fps // ms
        if (this.synth.update) {
            try {
                this.synth.update(dt);
            }
            catch (e) {
                console.log(e);
            }
        }
        this.sandbox.set('time', (this.synth.time += dt * 0.001 * this.synth.speed));
        this.timeSinceLastUpdate += dt;
        if (!this.synth.fps || this.timeSinceLastUpdate >= 1000 / this.synth.fps) {
            //  console.log(1000/this.timeSinceLastUpdate)
            this.synth.stats.fps = Math.ceil(1000 / this.timeSinceLastUpdate);
            //  console.log(this.synth.speed, this.synth.time)
            for (let i = 0; i < this.s.length; i++) {
                this.s[i].tick(this.synth.time);
            }
            //  console.log(this.canvas.width, this.canvas.height)
            for (let i = 0; i < this.o.length; i++) {
                this.o[i].tick({
                    time: this.synth.time,
                    mouse: this.synth.mouse,
                    bpm: this.synth.bpm,
                    resolution: [this.canvas.width, this.canvas.height],
                });
            }
            if (this.isRenderingAll) {
                this.renderAll({
                    tex0: this.o[0].getCurrent(),
                    tex1: this.o[1].getCurrent(),
                    tex2: this.o[2].getCurrent(),
                    tex3: this.o[3].getCurrent(),
                    resolution: [this.canvas.width, this.canvas.height],
                });
            }
            else {
                this.renderFbo({
                    tex0: this.output.getCurrent(),
                    resolution: [this.canvas.width, this.canvas.height],
                });
            }
            this.timeSinceLastUpdate = 0;
        }
        if (this.saveFrame === true) {
            this.canvasToImage();
            this.saveFrame = false;
        }
        //  this.regl.poll()
    }
}
exports.default = HydraRenderer;
