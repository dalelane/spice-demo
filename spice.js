/**
 * @fileoverview SPICE model demo.
 */

// Global constants.
const MODEL_URL = 'https://tfhub.dev/google/tfjs-model/spice/2/default/1'
const MODEL_SAMPLE_RATE = 16000;
// Corresponds to 64ms
const NUM_INPUT_SAMPLES = 1024;
const FFT_INPUT_WINDOW_SIZE = 1024;
const CONF_THRESHOLD = 0.8;
// 12 tones per octave.
const BINS_PER_OCTAVE = 12;
const PT_OFFSET = 25.58
const PT_SLOPE = 63.07
const SPICE_INPUT_SAMPLES = 3072;

// The model is loaded in startDemo().
let model;

// Canvases and outputs are initialized in run().
let canvas;
let tempCanvas;
let statusOutputElt;

// Callback that is called everytime a note was identified by the model.
let noteHandlerCallback;

/**
 * Note handler callback. Called whenever a new note is identified by the model.
 *
 * @callback noteHandlerCallback
 * @param {string} freqStr String representing the frequency of the note (eg, '50 Hz').
 * @param {string} noteStr String representing the note (eg, 'C#').
 * @param {string} confStr String representing the confidence of the note (eg, '50 %').
 * @param {number} note actual note value. May be null.
 */

/**
 * Initializes the demo.
 * @param {HTMLElement} docCanvas A canvas to draw the spectrogram and pitch on.
 * @param {HTMLElement} statusOutput Second line of output for status strings.
 * @param {noteHandlerCallback} noteHandler Callback called whenever a note is identified.
 */
function initialize(docCanvas, statusOutput, noteHandler) {
    canvas = docCanvas;
    tempCanvas = document.createElement('canvas');
    statusOutputElt = statusOutput;
    noteHandlerCallback = noteHandler;
}

async function startDemo() {
    model = await tf.loadGraphModel(MODEL_URL, { fromTFHub: true });
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(handleSuccess)
        .catch(handleError);
}

function handleError(err) {
    console.log(err);
    if (err.name == 'NotFoundError') {
        logStatus(
            '&nbsp;&nbsp;&nbsp;Could not find a microphone. Please connect a microphone or use a laptop.');
    }
}

function logStatus(text) {
    statusOutputElt.innerHTML = text + '<br>';
}

function logModelData(frequency, confidence) {
    let freqStr = '- &nbsp;&nbsp;';
    let noteStr = '';
    let note = null;
    if (confidence >= CONF_THRESHOLD) {
        freqStr = noDigits(frequency) + ' Hz';
        note = hz2note(frequency);
        noteStr = '  ' + getNoteStr(note);
    }
    const confStr = noDigits(confidence * 100.0) + ' %';
    noteHandlerCallback(freqStr, noteStr, confStr, note);
}

function avg(arr) {
    let sum = arr.reduce((sum, value) => sum + value);
    return sum / arr.length;
}

function noDigits(fnum) {
    return fnum.toFixed(0).padStart(3);
}

function twoDigits(fnum) {
    return fnum.toFixed(2).padStart(5);
}

function getPitchAndConfidence(labels, uncertainties) {
    confidences = [];
    for (let i = 0; i < uncertainties.length; ++i) {
        confidences.push(1.0 - uncertainties[i]);
    }
    pitches = [];
    for (let i = 0; i < labels.length; ++i) {
        pitches.push(label2hz(labels[i]));
    }
    return [pitches, confidences];
}

function getConfidentPitch(pitches, confidences) {
    let totalPitches = 0.0;
    let totalConf = 0.0;
    let numPitches = 0;
    // Remove first and last item to avoid border effects from CQT computation.
    for (let i = 1; i < pitches.length - 1; ++i) {
        let conf = confidences[i];
        if (conf < CONF_THRESHOLD) {
            continue;
        }
        totalPitches += pitches[i];
        totalConf += conf;
        numPitches++;
    }
    if (numPitches == 0) {
        return [0, 0];
    }
    return [totalPitches / numPitches, totalConf / numPitches];
}

function getGrayColor(value) {
    let v = 255 - (value / 2);
    return 'rgb(V, V, 255)'.replace(/V/g, v);
};

function getRedColor(conf) {
    let adj_conf = Math.max(0.0, conf - CONF_THRESHOLD) / CONF_THRESHOLD;
    let v = 255 * adj_conf;
    let opaqueness = adj_conf;
    return 'rgba(' + (255 - v) + ', 0, ' + v + ', ' + opaqueness + ')';
};

function label2hz(label) {
    let fmin = 10.0;
    let BINS_PER_OCTAVE = 12.0;
    let cqt_bin = label * PT_SLOPE + PT_OFFSET;
    return fmin * Math.pow(2.0, (1.0 * cqt_bin / BINS_PER_OCTAVE))
}

function hz2note(freq) {
    let fmin = 10.0;
    if (freq == 0) {
        return 0;
    }
    let oct = Math.log2(freq / fmin);
    // Add 0.5 to obtain the note that corresponds to the middle
    // (not the beginning) of the bin.
    return BINS_PER_OCTAVE * oct + 0.5;
}

function getNoteStr(note) {
    roundedNote = Math.round(note)
    let noteNames =
        ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
    if (roundedNote < 6) {
        return '';
    }
    noteName = noteNames[(roundedNote - 6) % 12];

    const noteDelta = note - roundedNote;
    if (noteDelta > 0.3) {
        noteName += '+';
    } else if (noteDelta < -0.3) {
        noteName += '-';
    }
    return noteName;
}

function analyzerBin2Note(bin) {
    let fmax = 8000;
    let num_bins = 512;
    let bin_frequency = bin * 1.0 * fmax / num_bins;
    return hz2note(bin_frequency);
}

function renderFreqDomain(confidences, pitches, freq, canvas, tempCanvas) {
    let width = canvas.width;
    let height = canvas.height;
    // With length 512 this will end up being 120 (10 octaves).
    let lastSemitone = Math.round(analyzerBin2Note(freq.length));
    let firstSemitone = 36;
    let numSemitones = lastSemitone + 1;
    let blockHeight = 2;
    let blockWidth = 2;

    // Copy the current canvas onto the temp canvas.
    tempCanvas.width = width;
    tempCanvas.height = height;

    let tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(canvas, 0, 0, width, height);

    // Iterate over the frequencies.
    let fftBySemitone = new Int32Array(numSemitones);
    let numBySemitone = new Int32Array(numSemitones);

    let lastNote = 0;
    for (let i = 0; i < freq.length; ++i) {
        let note = Math.round(analyzerBin2Note(i));
        fftBySemitone[note] += freq[i];
        numBySemitone[note] += 1;
        if (lastNote + 1 < note) {
            for (let j = lastNote + 1; j < note; ++j) {
                fftBySemitone[j] += freq[i];
                numBySemitone[j] += 1;
            }
        }
        lastNote = note;
    }

    ctx = canvas.getContext('2d');
    for (let i = firstSemitone; i < numSemitones; i++) {
        // Draw each pixel with the specific color.
        let amplitude = fftBySemitone[i];
        let num_ampls = (numBySemitone[i] + 1.0);
        let value = amplitude / num_ampls;
        ctx.fillStyle = getGrayColor(value);

        let percent = (i - firstSemitone) / lastSemitone;
        let y = Math.round(percent * height);

        // draw the line at the right side of the canvas
        ctx.fillRect(width - blockWidth, height - y, blockWidth, blockHeight);
    }

    let pitchStartX = width - (confidences.length * blockWidth);
    for (let i = 0; i < confidences.length; ++i) {
        let conf = confidences[i];

        if (confidences[i] < CONF_THRESHOLD) {
            continue;
        }

        let pitch = pitches[i];
        let semitone = hz2note(pitch);
        let percent = Math.max(0, semitone - firstSemitone) / lastSemitone;
        let y = Math.round(percent * height);
        let x = width - blockWidth - blockWidth -
            (confidences.length - i) * blockWidth * 0.5;
        tempCtx.fillStyle = getRedColor(conf);
        tempCtx.fillRect(x, height - y, blockWidth, blockHeight);
    }

    // Translate the canvas.
    ctx.translate(-blockWidth, 0);

    // Draw the copied image.
    ctx.drawImage(tempCanvas, 0, 0, width, height, 0, 0, width, height);

    // Reset the transformation matrix.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
};

function smooth(before, beforeWeight, current, currentWeight) {
    // 0.0 means not smooth. 1.0 means very smooth.
    let adj = 0.0;
    return (adj * beforeWeight * before + currentWeight * current) /
        (adj * beforeWeight + currentWeight)
}

function runModel(model, inputSamples, outputNodeNames, outMap) {
    if (inputSamples.length < SPICE_INPUT_SAMPLES) {
        return;
    }

    let input = tf.reshape(tf.tensor(inputSamples), [SPICE_INPUT_SAMPLES])
    let out = model.execute({ 'input_audio_samples': input }, outputNodeNames);
    for (let i = 0; i < outputNodeNames.length; ++i) {
        outMap[outputNodeNames[i]] = out[i].dataSync();
    }
}

function runModelFinal(model, inputDict) {
    for (let key in inputDict) {
        let value = inputDict[key];
        inputDict[key] = tf.reshape(tf.tensor(inputDict[key]), [-1, 257]);
    }

    out = model.execute(inputDict);

    const uncertainties = out[0].dataSync();
    const labels = out[1].dataSync();
    return getPitchAndConfidence(labels, uncertainties);
}

function handleSuccess(stream) {
    logStatus('');

    let context = new AudioContext({
        latencyHint: 'playback',
        sampleRate: MODEL_SAMPLE_RATE,
    });

    let source = context.createMediaStreamSource(stream);

    // Analyzer is not needed for pitch, used for displaying the spectrogram.
    let analyzer = context.createAnalyser();
    // This will convert/down-sample to mono.
    analyzer.channelInterpretation = 'speakers';
    analyzer.channelCount = 1;
    analyzer.smoothingTimeConstant = 0.0;
    analyzer.fftSize = NUM_INPUT_SAMPLES;
    source.connect(analyzer);

    // Gets input from source, calls model.
    let processor = context.createScriptProcessor(
        NUM_INPUT_SAMPLES,
      /*num_inp_channels=*/ 1,
      /*num_out_channels=*/ 1);
    processor.channelInterpretation = 'speakers';
    processor.channelCount = 1
    source.connect(processor);
    processor.connect(context.destination);

    let currentPitches = [];
    let currentConfidences = [];

    let smoothPitch = 0.0;
    let smoothConfidence = 0.0;
    let step = 0;
    let fftFrame = new Uint8Array(analyzer.frequencyBinCount);
    let samplesArray1 = [];  // new Float32Array(SPICE_INPUT_SAMPLES);
    let samplesArray2 = [];  // new Float32Array(SPICE_INPUT_SAMPLES);
    let samplesToUse = samplesArray1;
    let samplesToPush = samplesArray2;
    let modelOutput = {};

    processor.onaudioprocess = function (e) {
        let inputData = e.inputBuffer.getChannelData(0);
        samplesToPush.push(...inputData);

        if (step == 0) {
            // Step 1: First half of the CQT.
            runModel(
                model, samplesToUse,
                ['Real', 'Imag', 'Real_1', 'Imag_1', 'Real_2', 'Imag_2'],
                modelOutput);
            ++step;
        } else if (step == 1) {
            // Step 2: Second half of the CQT.
            runModel(
                model, samplesToUse,
                ['Real_3', 'Imag_3', 'Real_4', 'Imag_4', 'Real_5', 'Imag_5'],
                modelOutput);
            ++step;
        } else if (step == 2) {
            // Step 3: The actual pitch + confidence computation.
            if (samplesToUse.length >= SPICE_INPUT_SAMPLES) {
                // Compute model output given CQT.
                [currentPitches, currentConfidences] =
                    runModelFinal(model, modelOutput);
                [smoothPitch, smoothConfidence] =
                    getConfidentPitch(currentPitches, currentConfidences);
                logModelData(smoothPitch, smoothConfidence);
            }

            // We pushed enough samples (3x). We can use them in the next iteration.
            let toUse = samplesToPush;

            // Used those samples in the three steps above, make room for new ones.
            samplesToPush = samplesToUse;
            samplesToPush = [];

            // Run model on those, next.
            modelOutput = {};
            samplesToUse = toUse;
            step = 0;
        }

        analyzer.getByteFrequencyData(fftFrame);
        renderFreqDomain(
            currentConfidences, currentPitches, fftFrame, canvas, tempCanvas);
        currentConfidences = [];
        currentPitches = [];
    }
}

// A class that knows how to draw notes into the given HTML element.
class NoteRenderer {
    /**
    * Constructs a note renderer object that will render into the give HTML element.
    * @param {HTMLElement} el HTML to render notes into.
    */
    constructor(el) {
        this.renderer = new Vex.Flow.Renderer(el, Vex.Flow.Renderer.Backends.SVG);
        // Configure the rendering context.
        this.renderer.resize(800, 500);
        this.context = this.renderer.getContext();

        // A tickContext is required to draw anything that would be placed
        // in relation to time/rhythm, including StaveNote which we use here.
        // In real music, this allows VexFlow to align notes from multiple
        // voices with different rhythms horizontally. Here, it doesn't do much
        // for us, since we'll be animating the horizontal placement of notes,
        // but we still need to add our notes to a tickContext so that they get
        // an x value and can be rendered.
        //
        // If we create a voice, it will automatically apply a tickContext to our
        // notes, and space them relative to each other based on their duration &
        // the space available. We definitely do not want that here! So, instead
        // of creating a voice, we handle that part of the drawing manually.
        this.tickContext = new Vex.Flow.TickContext();

        // Create a treble stave of width 10000 at position 10, 10 on the canvas.
        this.stave = new Vex.Flow.Stave(10, 10, 20000)
            .addClef('treble');
        // Connect it to the rendering context and draw!
        this.stave.setContext(this.context).draw();

        // add a bass stave below
        this.stave2 = new Vex.Flow.Stave(10, 100, 20000);
        this.stave2.addClef("bass");
        this.stave2.setContext(this.context).draw();

        // This will contain any notes that are currently visible on the staff,
        // before they've either been answered correctly, or plumetted off
        // the staff when a user fails to answer them correctly in time.
        // TODO: Add sound effects.
        this.visibleNoteGroups = [];

        this.mutex = new mutex_();

        this.count = 0;
    }

    async draw_note(n) {
        // Draw every third note only.
        if (!n || ++this.count % 3) return;
        var unlock = await this.mutex.lock();

        try {
            const [noteName, oct] = this.formatNote_(n);

            var note = new Vex.Flow.StaveNote({
                clef: (oct < 4) ? 'bass' : 'treble',
                keys: [`${noteName}/${oct}`],
                duration: '8d',  // Each note corresponds to roughly 192ms ~= 3/16th.
            }).setContext(this.context).setStave((oct < 4) ? this.stave2 : this.stave);

            // If a StaveNote has an accidental, we must render it manually.
            // This is so that you get full control over whether to render
            // an accidental depending on the musical context. Here, if we
            // have one, we want to render it. (Theoretically, we might
            // add logic to render a natural sign if we had the same letter
            // name previously with an accidental. Or, perhaps every twelfth
            // note or so we might render a natural sign randomly, just to be
            // sure our user who's learning to read accidentals learns
            // what the natural symbol means.)
            if (noteName.includes("#")) note.addAccidental(0, new Vex.Flow.Accidental("#"));
            this.tickContext.addTickable(note);
            this.tickContext.preFormat().setX(600);

            const group = this.context.openGroup();
            this.visibleNoteGroups.push(group);
            note.draw();
            this.context.closeGroup();
            group.classList.add('scroll');
            // Force a dom-refresh by asking for the group's bounding box. Why? Most
            // modern browsers are smart enough to realize that adding .scroll class
            // hasn't changed anything about the rendering, so they wait to apply it
            // at the next dom refresh, when they can apply any other changes at the
            // same time for optimization. However, if we allow that to happen,
            // then sometimes the note will immediately jump to its fully transformed
            // position -- because the transform will be applied before the class with
            // its transition rule.
            const box = group.getBoundingClientRect();
            group.classList.add('scrolling');

            window.setTimeout(() => {
                const index = this.visibleNoteGroups.indexOf(group);
                this.visibleNoteGroups.shift();
                if (index === -1) return;
                group.classList.add('too-slow');
            }, 8500);
        }
        catch (error) {
            console.error(error);
            // expected output: ReferenceError: nonExistentFunction is not defined
            // Note - error messages will vary depending on browser
        }
        finally {
            unlock();
        }
    }

    formatNote_(note) {
        var roundedNote = Math.round(note)
        var noteNames = ["A", "A#", "B", "C", "C#", "D",
            "D#", "E", "F", "F#", "G", "G#"];
        if (roundedNote < 6) {
            return "";
        }
        var noteName = noteNames[(roundedNote - 6) % 12];
        var oct = Math.round((roundedNote - 6 + 3) / 12) - 1;
        return [noteName, oct];
    }
}

 // Helper function that simluates a mutex.
 function mutex_() {
    let current = Promise.resolve();
    this.lock = () => {
        let _resolve;
        const p = new Promise(resolve => {
            _resolve = () => resolve();
        });
        // Caller gets a promise that resolves when the current outstanding
        // lock resolves
        const rv = current.then(() => _resolve);
        // Don't allow the next request until the new promise is done
        current = p;
        // Return the new promise
        return rv;
    };
}

window.addEventListener('load', () => {
  document.getElementById('start-demo-button')
      .addEventListener('click', startDemo);
});
