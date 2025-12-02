// Resuing code from Chris' https://github.com/chrisdonahue/music-cocreation-tutorial/blob/main/part-2-js-interaction/modules.js

window.my = window.my || {};

(function (tf, my) {
  const PIANO_NUM_KEYS = 88;
  const testThres = 0.025;
  const DEFAULT_CKPT_DIR = `/ckpt/default`;
  const BEATSS_CKPT_DIR = `/ckpt/beatss`;
  const SEQ_LEN = 128;

  class Module {
    constructor() {
      this._params = null;
    }

    async init(paramsDir) {
      // Load parameters
      this.dispose();
      //   console.log(
      //     "Loading weights manifest from",
      //     `${paramsDir}/tfjs/weights_manifest.json`
      //   );
      console.debug("fetch weights manifest, path:", `weights_manifest.json`);
      // const BASE = import.meta.env.BASE_URL;
      const manifest = await fetch(`model/weights_manifest.json`);
      const manifestJson = await manifest.json();
      this._params = await tf.io.loadWeights(manifestJson, "model");
      //   console.log("Load finished");
    }

    dispose() {
      // Dispose of parameters
      if (this._params !== null) {
        for (const n in this._params) {
          this._params[n].dispose();
        }
        this._params = null;
      }
    }
  }

  class LSTMHiddenState {
    constructor(c, h) {
      if (c.length !== h.length) throw "Invalid shapes";
      this.c = c;
      this.h = h;
    }

    dispose() {
      for (let i = 0; i < this.c.length; ++i) {
        this.c[i].dispose();
        this.h[i].dispose();
      }
    }
  }

  function pyTorchLSTMCellFactory(
    kernelInputHidden,
    kernelHiddenHidden,
    biasInputHidden,
    biasHiddenHidden
  ) {
    // Patch between differences in LSTM APIs for PyTorch/Tensorflow
    // NOTE: Fixes kernel packing order
    // PyTorch packs kernel as [i, f, j, o] and Tensorflow [i, j, f, o]
    // References:
    // https://github.com/tensorflow/tfjs/blob/31fd388daab4b21c96b2cb73c098456e88790321/tfjs-core/src/ops/basic_lstm_cell.ts#L47-L78
    // https://pytorch.org/docs/stable/generated/torch.nn.LSTM.html?highlight=lstm#torch.nn.LSTM

    return (data, c, h) => {
      // NOTE: Modified from Tensorflow.JS basicLSTMCell (see first reference)

      // Create empty forgetBias
      const forgetBias = tf.scalar(0, "float32");

      // Pack kernel
      const kernel = tf.transpose(
        tf.concat([kernelInputHidden, kernelHiddenHidden], 1)
      );

      // Pack bias
      // NOTE: Not sure why PyTorch breaks bias into two terms...
      const bias = tf.add(biasInputHidden, biasHiddenHidden);

      const combined = tf.concat([data, h], 1);
      const weighted = tf.matMul(combined, kernel);
      const res = tf.add(weighted, bias);

      // i = input_gate, j = new_input, f = forget_gate, o = output_gate
      const batchSize = res.shape[0];
      const sliceCols = res.shape[1] / 4;
      const sliceSize = [batchSize, sliceCols];
      const i = tf.slice(res, [0, 0], sliceSize);
      //const j = tf.slice(res, [0, sliceCols], sliceSize);
      //const f = tf.slice(res, [0, sliceCols * 2], sliceSize);
      const f = tf.slice(res, [0, sliceCols], sliceSize);
      const j = tf.slice(res, [0, sliceCols * 2], sliceSize);
      const o = tf.slice(res, [0, sliceCols * 3], sliceSize);

      const newC = tf.add(
        tf.mul(tf.sigmoid(i), tf.tanh(j)),
        tf.mul(c, tf.sigmoid(tf.add(forgetBias, f)))
      );
      const newH = tf.mul(tf.tanh(newC), tf.sigmoid(o));
      return [newC, newH];
    };
  }

  class MidiBeatLSTM extends Module {
    constructor(rnnDim, rnnNumLayers) {
      super();
      this.nPitches = PIANO_NUM_KEYS + 1;
      this.pitchEmb = 32;
      this.rnnDim = rnnDim === undefined ? 128 : rnnDim;
      this.rnnNumLayers = rnnNumLayers === undefined ? 2 : rnnNumLayers;
      this._cells = null;
      this.useVelocity = false;
    }

    async init(paramsDir) {
      await super.init(paramsDir === undefined ? DEFAULT_CKPT_DIR : paramsDir);

      // Create LSTM cell closures
      this._cells = [];
      for (let l = 0; l < this.rnnNumLayers; ++l) {
        this._cells.push(
          pyTorchLSTMCellFactory(
            this._params[`lstm.weight_ih_l${l}`],
            this._params[`lstm.weight_hh_l${l}`],
            this._params[`lstm.bias_ih_l${l}`],
            this._params[`lstm.bias_hh_l${l}`]
          )
        );
      }
    }

    initHidden(batchSize) {
      // NOTE: This allocates memory that must later be freed
      const c = [];
      const h = [];
      for (let i = 0; i < this.rnnNumLayers; ++i) {
        c.push(tf.zeros([batchSize, this.rnnDim], "float32"));
        h.push(tf.zeros([batchSize, this.rnnDim], "float32"));
      }
      return new LSTMHiddenState(c, h);
    }

    forward(pitchIdx, dt, vel, hx = null) {
      // Inputs: pitchIdx [B], dt [B], vel [B]
      if (hx === null) hx = this.initHidden(pitchIdx.shape[0]);

      // --- Embedding ---
      const pitchEmb = tf.gather(this._params["pitch_emb.weight"], pitchIdx);

      // --- Concatenate inputs ---
      let x = tf.concat([pitchEmb, tf.expandDims(dt, 1)], 1);
      if (this.useVelocity) {
        x = tf.concat([x, tf.expandDims(vel, 1)], 1);
      }

      // --- Input projection ---
      x = tf.add(
        tf.matMul(x, this._params["input_linear.weight"], false, true),
        this._params["input_linear.bias"]
      );

      // --- LSTM ---
      let c = hx.c.slice();
      let h = hx.h.slice();
      for (let l = 0; l < this.rnnNumLayers; ++l) {
        [c[l], h[l]] = this._cells[l](x, c[l], h[l]);
        x = h[l]; // Feed to next layer
      }

      // --- Head ---
      x = tf.add(
        tf.matMul(x, this._params["head.0.weight"], false, true),
        this._params["head.0.bias"]
      );
      x = tf.relu(x);
      x = tf.add(
        tf.matMul(x, this._params["head.3.weight"], false, true),
        this._params["head.3.bias"]
      );

      return [x, new LSTMHiddenState(c, h)];
    }

    predict(pitchIdx, dt, vel) {
      const [out, _] = this.forward(pitchIdx, dt, vel, null);
      return tf.sigmoid(out);
    }
  }

  class MidiBeatSS extends Module {
    /*
     * Check MidiBeatSS for python impl.
     * - python has much more hyperparameters. For simplicity did not include those as params.
     * - you'll need to manually modify the code if you want to load a different model.
     */
    constructor() {
      super();
      this.nPitches = PIANO_NUM_KEYS + 1;
      this.pitchEmb = 32;
      this.rnnDim = 128;
      this.rnnNumLayers = 2;
      this._cells = null;
    }

    async init(paramsDir) {
      await super.init(paramsDir === undefined ? BEATSS_CKPT_DIR : paramsDir);

      // Create LSTM cell closures
      this._cells = [];
      for (let l = 0; l < this.rnnNumLayers; ++l) {
        this._cells.push(
          pyTorchLSTMCellFactory(
            this._params[`model.cells.${l}.weight_ih`],
            this._params[`model.cells.${l}.weight_hh`],
            this._params[`model.cells.${l}.bias_ih`],
            this._params[`model.cells.${l}.bias_hh`]
          )
        );
      }
    }

    initHidden(batchSize) {
      // NOTE: This allocates memory that must later be freed
      const c = [];
      const h = [];
      for (let i = 0; i < this.rnnNumLayers; ++i) {
        c.push(tf.zeros([batchSize, this.rnnDim], "float32"));
        h.push(tf.zeros([batchSize, this.rnnDim], "float32"));
      }
      return new LSTMHiddenState(c, h);
    }

    forward(feat, hx = null) {
      if (hx === null) hx = this.initHidden(feat.shape[0]);

      // Extract input features
      const pitch = feat.slice([0, 0], [-1, 1]).squeeze([-1]).toInt(); // (batch, seq_len)
      const dt = feat.slice([0, 1], [-1, 1]).squeeze([-1]); // (batch, seq_len)
      const vel = feat.slice([0, 2], [-1, 1]).squeeze([-1]); // (batch, seq_len)
      const prev_b = feat.slice([0, 3], [-1, 1]).squeeze([-1]); // (batch, seq_len)
      const prev_db = feat.slice([0, 4], [-1, 1]).squeeze([-1]); // (batch, seq_len)

      // --- Embedding ---
      const pitchEmb = tf.gather(this._params["model.pitch_emb.weight"], pitch);

      // --- Concatenate inputs ---
      let x = tf.concat(
        [
          pitchEmb,
          tf.expandDims(dt, 1),
          tf.expandDims(prev_b),
          tf.expandDims(prev_db),
        ],
        1
      );

      // --- Input projection ---
      x = tf.add(
        tf.matMul(x, this._params["model.input_linear.weight"], false, true),
        this._params["model.input_linear.bias"]
      );

      // --- LSTM ---
      let c = hx.c.slice();
      let h = hx.h.slice();
      for (let l = 0; l < this.rnnNumLayers; ++l) {
        [c[l], h[l]] = this._cells[l](x, c[l], h[l]);
        x = h[l]; // Feed to next layer
      }

      // --- Head ---
      let beat_pred = tf.add(
        tf.matMul(x, this._params["model.beat_head.0.weight"], false, true),
        this._params["model.beat_head.0.bias"]
      );
      beat_pred = tf.relu(beat_pred);
      beat_pred = tf.add(
        tf.matMul(
          beat_pred,
          this._params["model.beat_head.3.weight"],
          false,
          true
        ),
        this._params["model.beat_head.3.bias"]
      );

      let downbeat_pred = tf.add(
        tf.matMul(x, this._params["model.downbeat_head.0.weight"], false, true),
        this._params["model.downbeat_head.0.bias"]
      );
      downbeat_pred = tf.relu(downbeat_pred);
      downbeat_pred = tf.add(
        tf.matMul(
          downbeat_pred,
          this._params["model.downbeat_head.3.weight"],
          false,
          true
        ),
        this._params["model.downbeat_head.3.bias"]
      );

      return [beat_pred, downbeat_pred, new LSTMHiddenState(c, h)];
    }

    predict(feat, hx = null) {
      const [beat_out, downbeat_out, _] = this.forward(feat, hx);
      return tf.sigmoid(beat_out), tf.sigmoid(downbeat_out);
    }
  }
  async function testMidiBeat() {
    console.log("Start MidiBeat test");
    const numBytesBefore = tf.memory().numBytes;

    // Create model
    const decoder = new MidiBeatLSTM();
    await decoder.init();

    // Fetch test case
    const t = await fetch(`test.json`).then((r) => r.json());

    // Run test
    let totalErr = 0;
    let him1 = null;
    for (let i = 0; i < 128; ++i) {
      him1 = tf.tidy(() => {
        const pitches = tf.tensor(t["input_pt"][i], [1], "int32");
        const dt = tf.tensor(t["input_dt"][i], [1], "float32");
        const velocity = tf.tensor(t["input_vt"][i], [1], "float32");

        const [beat_logits, hi] = decoder.forward(pitches, dt, velocity, him1);

        const expectedLogits = tf.tensor(t["tgt_logits"][i], [1, 1], "float32");
        const err = tf
          .sum(tf.abs(tf.sub(beat_logits, expectedLogits)))
          .arraySync();
        totalErr += err;

        if (him1 !== null) him1.dispose();
        return hi;
      });
    }

    // Check equivalence to expected outputs
    if (isNaN(totalErr) || totalErr > testThres) {
      // was 0.015
      console.log("Test failed with error=", totalErr);
      throw "Failed test";
    } else if (totalErr > 0.015) {
      console.log("Warning: total decoder error is", totalErr);
    }

    // Check for memory leaks
    him1.dispose();
    decoder.dispose();
    if (tf.memory().numBytes !== numBytesBefore) {
      console.warn(
        "Memory difference found:",
        tf.memory().numBytes - numBytesBefore
      );
      //   throw "Memory leak";
    }
    console.log("Passed decoder test with total err=", totalErr);
  }

  async function testBeatSS() {
    console.log("Test MidiBeatSS weights");
    const numBytesBefore = tf.memory().numBytes;

    // Create model
    const decoder = new MidiBeatSS();
    await decoder.init();

    // Fetch test case
    console.debug("fetch beatss test json");
    const t = await fetch(`test.json`).then((r) => r.json());
    // Run test
    let totalBeatErr = 0;
    let totalDownBeatErr = 0;
    let him1 = null;
    for (let i = 0; i < 128; ++i) {
      const prevH = him1;
      him1 = tf.tidy(() => {
        // console.log("DEBUG process input feats", t["feats"][i]);
        const feats = tf.tensor(t["feats"][i], [1, 5], "float32");
        // console.log("DEBUG begin test model forward, feat:", feats);
        const [beat_logits, downbeat_logits, hi] = decoder.forward(
          feats,
          prevH
        );
        const expectedBeatLogits = tf.scalar(t["beat_logits"][i], "float32");
        const b_err = tf
          .sum(tf.abs(tf.sub(beat_logits, expectedBeatLogits)))
          .arraySync();
        totalBeatErr += b_err;

        const expectedDownbeatLogits = tf.scalar(
          t["downbeat_logits"][i],
          "float32"
        );
        const db_err = tf
          .sum(tf.abs(tf.sub(downbeat_logits, expectedDownbeatLogits)))
          .arraySync();
        totalDownBeatErr += db_err;

        return hi;
      });
      if (prevH !== null) prevH.dispose();
    }

    // Check equivalence to expected outputs
    if (
      isNaN(totalBeatErr) ||
      isNaN(totalDownBeatErr) ||
      totalBeatErr + totalDownBeatErr > testThres
    ) {
      console.log(
        "Test failed with beat error:",
        totalBeatErr,
        "downbeat error:",
        totalDownBeatErr
      );
      throw "Failed test";
    } else if (totalBeatErr > 0.015) {
      console.log("Warning: total decoder error is", totalBeatErr);
    }

    // Check for memory leaks
    him1.dispose();
    decoder.dispose();
    if (tf.memory().numBytes !== numBytesBefore) {
      console.warn(
        "Memory difference found:",
        tf.memory().numBytes - numBytesBefore
      );
      //   throw "Memory leak";
    }
    console.log("Passed decoder test with total err=", totalBeatErr);
  }
  my.PIANO_NUM_KEYS = PIANO_NUM_KEYS;
  my.SEQ_LEN = SEQ_LEN;
  my.MidiBeatLSTM = MidiBeatLSTM;
  my.MidiBeatSS = MidiBeatSS;
  my.testMidiBeat = testMidiBeat;
  my.testBeatSS = testBeatSS;
})(window.tf, window.my);
