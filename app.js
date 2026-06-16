// Update whenever code changes (shown in UI below header).
const LAST_UPDATE_NOTE = "NanoDet-Plus-M model.";
const LAST_UPDATE_TIME = "Jun 17, 2026";

const imageInput = document.getElementById("imageInput");
const captureBtn = document.getElementById("captureBtn");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const croppedPlateImg = document.getElementById("croppedPlate");
const plateText = document.getElementById("plateText");
const confidenceBadge = document.getElementById("confidenceBadge");
const response_time = document.getElementById("response_time");
const loading_icon = document.querySelectorAll("#loading_container span")[0];
const loading = document.getElementById("loading");
const recordsList = document.getElementById("recordsList");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const clearBtn = document.getElementById("clearBtn");
const previewSection = document.getElementById("previewSection");
const previewEmpty = document.getElementById("previewEmpty");
const processingStepper = document.getElementById("processingStepper");
const stepperProgress = document.getElementById("stepperProgress");
const errorState = document.getElementById("errorState");
const errorTitle = document.getElementById("errorTitle");
const errorHint = document.getElementById("errorHint");
const resultContent = document.getElementById("resultContent");
const toastBanner = document.getElementById("toastBanner");
const lastUpdateText = document.getElementById("lastUpdateText");
const lastUpdateTime = document.getElementById("lastUpdateTime");

const STORAGE_KEY = "plate_demo_records";
const STEPPER_STEPS = ["upload", "detect", "ocr", "done"];
const ERROR_MESSAGES = {
    no_plate: {
        title: "No plate found",
        hint: "Try closer, brighter, or straighter angle"
    },
    models_loading: {
        title: "Models still loading",
        hint: "Please wait a moment and try again"
    }
};

let detectorModel;
let ocrModel;
let stepperResetTimer = null;

window.onload = function () {
    lastUpdateText.textContent = LAST_UPDATE_NOTE;
    if (lastUpdateTime) lastUpdateTime.textContent = LAST_UPDATE_TIME;
    loadModels();
    renderRecords();
    setIdleResultState();
};

async function loadModels() {
    previewSection.classList.add("is-loading-models");
    loading_icon.setAttribute("class", "bi bi-cloud-download pulse");
    loading.innerText = "Loading AI models...";

    if (typeof ort !== "undefined" && ort.env?.wasm) {
        ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
    }

    // detectorModel = await ort.InferenceSession.create("./models/best.onnx");
    detectorModel = await ort.InferenceSession.create("./models/nanodet-plus-m_320.onnx");
    ocrModel = await ort.InferenceSession.create("./models/cct_s_v2_global.onnx");

    previewSection.classList.remove("is-loading-models");
    loading_icon.setAttribute("class", "bi bi-record-circle pulse");
    loading.innerText = "Ready";
}

function syncStepperLineLayout() {
    const track = document.querySelector(".stepper-track");
    const icons = track.querySelectorAll(".stepper-icon");
    if (icons.length < 2) return;

    const trackRect = track.getBoundingClientRect();
    const firstCenter = icons[0].getBoundingClientRect().left + icons[0].offsetWidth / 2 - trackRect.left;
    const lastCenter = icons[icons.length - 1].getBoundingClientRect().left + icons[icons.length - 1].offsetWidth / 2 - trackRect.left;
    const lineWidth = lastCenter - firstCenter;

    track.style.setProperty("--stepper-line-left", `${firstCenter}px`);
    track.style.setProperty("--stepper-line-width", `${lineWidth}px`);
}

function setProcessingStep(step) {
    clearTimeout(stepperResetTimer);
    processingStepper.classList.remove("d-none");

    requestAnimationFrame(() => {
        syncStepperLineLayout();

        const stepIndex = STEPPER_STEPS.indexOf(step);
        const track = document.querySelector(".stepper-track");
        const lineWidth = parseFloat(track.style.getPropertyValue("--stepper-line-width")) || track.clientWidth * 0.75;
        const progress = stepIndex <= 0 ? 0 : stepIndex / (STEPPER_STEPS.length - 1);

        stepperProgress.style.width = `${lineWidth * progress}px`;

        document.querySelectorAll(".stepper-step").forEach(el => {
            const currentIndex = STEPPER_STEPS.indexOf(el.dataset.step);
            el.classList.remove("active", "done");

            if (currentIndex < stepIndex) {
                el.classList.add("done");
            } else if (currentIndex === stepIndex) {
                el.classList.add("active");
            }
        });
    });
}

function hideProcessingStepper() {
    processingStepper.classList.add("d-none");
    document.querySelectorAll(".stepper-step").forEach(el => {
        el.classList.remove("active", "done");
    });
    stepperProgress.style.width = "0";
}

window.addEventListener("resize", () => {
    if (!processingStepper.classList.contains("d-none")) {
        const activeStep = STEPPER_STEPS.find(step =>
            document.querySelector(`.stepper-step[data-step="${step}"]`)?.classList.contains("active")
        );
        if (activeStep) setProcessingStep(activeStep);
    }
});

function scheduleStepperReset() {
    stepperResetTimer = setTimeout(hideProcessingStepper, 2500);
}

function setIdleResultState() {
    errorState.classList.remove("visible");
    resultContent.classList.remove("hidden");
    plateText.innerText = "Waiting...";
    confidenceBadge.classList.add("d-none");
    response_time.innerText = "Upload or Capture Vehicle Image";
}

function showErrorState(type, customHint) {
    const message = ERROR_MESSAGES[type] || ERROR_MESSAGES.no_plate;

    errorTitle.innerText = message.title;
    errorHint.innerText = customHint || message.hint;
    errorState.classList.add("visible");
    resultContent.classList.add("hidden");
    confidenceBadge.classList.add("d-none");
    plateText.innerText = "—";
    response_time.innerText = "Scan failed — adjust and try again";
}

function showToast(message) {
    toastBanner.innerText = message;
    toastBanner.classList.add("visible");

    setTimeout(() => {
        toastBanner.classList.remove("visible");
    }, 3500);
}

function showConfidence(confidence) {
    const percent = Math.round(confidence * 100);
    confidenceBadge.innerText = `${percent}%`;
    confidenceBadge.classList.remove("d-none", "low");
    confidenceBadge.classList.toggle("low", percent < 60);
}

let startTime = null;

captureBtn.addEventListener("click", () => {
    imageInput.value = "";

    if (window.innerWidth <= 768) {
        imageInput.setAttribute("capture", "environment");
    } else {
        imageInput.removeAttribute("capture");
    }

    imageInput.click();
});

imageInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!detectorModel || !ocrModel) {
        showErrorState("models_loading");
        showToast("AI models are still loading. Please wait.");
        return;
    }

    setProcessingStep("upload");
    loading_icon.setAttribute("class", "bi bi-camera pulse");
    loading.innerText = "Processing...";
    errorState.classList.remove("visible");
    resultContent.classList.remove("hidden");
    plateText.innerText = "Processing...";
    confidenceBadge.classList.add("d-none");
    croppedPlateImg.removeAttribute("src");

    const img = await loadImage(file);
    previewEmpty.classList.add("hidden");
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    await new Promise(r => setTimeout(r, 100));

    setProcessingStep("detect");
    startTime = performance.now();

    const result = await processImage(img);

    if (!result.success) {
        setProcessingStep("done");
        scheduleStepperReset();
        loading_icon.setAttribute("class", "bi bi-record-circle pulse");
        loading.innerText = "Ready";
        showErrorState("no_plate");
        return;
    }

    setProcessingStep("done");
    scheduleStepperReset();

    loading_icon.setAttribute("class", "bi bi-record-circle pulse");
    loading.innerText = "Ready";

    plateText.innerText = result.plate;
    showConfidence(result.confidence);

    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    response_time.innerText = "Response Time: " + duration + " Sec";

    saveRecord({
        response_time: duration,
        croppedImage: result.croppedImage,
        plate: result.plate,
        confidence: result.confidence,
        date: new Date().toLocaleString()
    });

    renderRecords();
});

function loadImage(file) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = URL.createObjectURL(file);
    });
}

function getAdaptiveLineWidth(imgWidth) {
    const previewWrap = document.getElementById("previewWrap");
    const displayWidth = previewWrap.clientWidth || imgWidth;
    const targetScreenPx = 3.375;
    const lineWidth = (targetScreenPx * imgWidth) / displayWidth;

    return Math.max(3, Math.min(36, Math.round(lineWidth)));
}

function getBoxSurroundLuminance(ctx, x, y, w, h, pad) {
    const canvas = ctx.canvas;
    const outerX = Math.max(0, Math.floor(x - pad));
    const outerY = Math.max(0, Math.floor(y - pad));
    const outerW = Math.min(canvas.width - outerX, Math.ceil(w + pad * 2));
    const outerH = Math.min(canvas.height - outerY, Math.ceil(h + pad * 2));
    const innerX = Math.floor(x);
    const innerY = Math.floor(y);
    const innerW = Math.ceil(w);
    const innerH = Math.ceil(h);

    const data = ctx.getImageData(outerX, outerY, outerW, outerH).data;
    let sum = 0;
    let count = 0;

    for (let py = 0; py < outerH; py++) {
        for (let px = 0; px < outerW; px++) {
            const absX = outerX + px;
            const absY = outerY + py;

            if (absX >= innerX && absX < innerX + innerW && absY >= innerY && absY < innerY + innerH) {
                continue;
            }

            const i = (py * outerW + px) * 4;
            sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            count++;
        }
    }

    return count ? sum / count : 128;
}

function getContrastStrokeColor(luminance) {
    if (luminance < 128) {
        return "#00ffcc";
    }

    return "#c62828";
}

function drawPlateHighlight(ctx, x, y, w, h, imgWidth) {
    const lineWidth = getAdaptiveLineWidth(imgWidth);
    const samplePad = Math.max(8, Math.min(w, h) * 0.2);
    const luminance = getBoxSurroundLuminance(ctx, x, y, w, h, samplePad);
    const strokeColor = getContrastStrokeColor(luminance);
    const inset = lineWidth / 2;

    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.strokeRect(x - inset, y - inset, w + inset * 2, h + inset * 2);
    ctx.restore();

    return { lineWidth, strokeColor, luminance };
}

async function processImage(img) {
    // const inputSize = 640;
    const inputSize = 320;

    const inputCanvas = document.createElement("canvas");
    inputCanvas.width = inputSize;
    inputCanvas.height = inputSize;

    const inputCtx = inputCanvas.getContext("2d");
    inputCtx.drawImage(img, 0, 0, inputSize, inputSize);

    const imageData = inputCtx.getImageData(0, 0, inputSize, inputSize);
    const input = new Float32Array(1 * 3 * inputSize * inputSize);

    for (let i = 0; i < inputSize * inputSize; i++) {
        input[i] = imageData.data[i * 4] / 255;
        input[i + inputSize * inputSize] = imageData.data[i * 4 + 1] / 255;
        input[i + 2 * inputSize * inputSize] = imageData.data[i * 4 + 2] / 255;
    }

    const tensor = new ort.Tensor("float32", input, [1, 3, inputSize, inputSize]);

    const outputs = await detectorModel.run({
        [detectorModel.inputNames[0]]: tensor
    });

    const output = outputs[detectorModel.outputNames[0]];
    // const detections = parseYoloV8Output(output.data, output.dims);
    const detections = parseNanoDetOutput(output.data, output.dims, inputSize);

    if (detections.length === 0) {
        return { success: false, error: "no_plate" };
    }

    const best = detections[0];

    const scaleX = img.width / inputSize;
    const scaleY = img.height / inputSize;

    let x = Math.max(0, best.x * scaleX);
    let y = Math.max(0, best.y * scaleY);
    let w = Math.min(best.w * scaleX, img.width - x);
    let h = Math.min(best.h * scaleY, img.height - y);

    const plateCanvas = document.createElement("canvas");
    plateCanvas.width = Math.round(w);
    plateCanvas.height = Math.round(h);

    const plateCtx = plateCanvas.getContext("2d");
    plateCtx.drawImage(img, x, y, w, h, 0, 0, plateCanvas.width, plateCanvas.height);

    const croppedBase64 = plateCanvas.toDataURL("image/jpeg", 0.9);
    croppedPlateImg.src = croppedBase64;

    drawPlateHighlight(ctx, x, y, w, h, img.width);

    setProcessingStep("ocr");
    const plate = await recognizePlateWithFastPlateOCR(plateCanvas);

    return {
        success: true,
        plate,
        confidence: best.confidence,
        croppedImage: croppedBase64,
        capturedImage: canvas.toDataURL("image/jpeg", 0.8)
    };
}
function parseNanoDetOutput(data, dims, inputSize = 320) {
    const detections = [];
    const numClasses = 80; // COCO classes — plate is class 2 (car) or use score threshold
    const regMax = 7;      // nanodet-plus default
    const strides = [8, 16, 32, 64];
  
    let offset = 0;
  
    for (const stride of strides) {
      const gridH = Math.ceil(inputSize / stride);
      const gridW = Math.ceil(inputSize / stride);
  
      for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
          // Class scores
          let maxScore = 0;
          let maxClass = 0;
  
          for (let c = 0; c < numClasses; c++) {
            const score = data[offset + c];
            if (score > maxScore) {
              maxScore = score;
              maxClass = c;
            }
          }
  
          // Box regression (DFL)
          const boxOffset = offset + numClasses;
          const lt_x = dfl(data, boxOffset,            regMax) * stride;
          const lt_y = dfl(data, boxOffset + regMax,     regMax) * stride;
          const rb_x = dfl(data, boxOffset + regMax * 2, regMax) * stride;
          const rb_y = dfl(data, boxOffset + regMax * 3, regMax) * stride;
  
          const cx = (x + 0.5) * stride;
          const cy = (y + 0.5) * stride;
  
          const bx = cx - lt_x;
          const by = cy - lt_y;
          const bw = lt_x + rb_x;
          const bh = lt_y + rb_y;
  
          if (maxScore > 0.3) {
            detections.push({
              x: bx,
              y: by,
              w: bw,
              h: bh,
              confidence: maxScore,
              classId: maxClass
            });
          }
  
          offset += numClasses + regMax * 4;
        }
      }
    }
  
    detections.sort((a, b) => b.confidence - a.confidence);
    return detections;
  }
  
  function dfl(data, startOffset, regMax) {
    let sum = 0, weightSum = 0;
    for (let i = 0; i < regMax; i++) {
      const w = Math.exp(data[startOffset + i]);
      sum += w * i;
      weightSum += w;
    }
    return sum / weightSum;
  }
function parseYoloV8Output(data, dims) {
    const detections = [];

    if (dims.length !== 3) return detections;

    if (dims[1] < dims[2]) {
        const numBoxes = dims[2];

        for (let i = 0; i < numBoxes; i++) {
            const cx = data[i];
            const cy = data[numBoxes + i];
            const w = data[2 * numBoxes + i];
            const h = data[3 * numBoxes + i];
            const score = data[4 * numBoxes + i];

            if (score < 0.15) continue;

            detections.push({
                x: cx - w / 2,
                y: cy - h / 2,
                w,
                h,
                confidence: score
            });
        }
    } else {
        const numBoxes = dims[1];
        const numValues = dims[2];

        for (let i = 0; i < numBoxes; i++) {
            const offset = i * numValues;

            const cx = data[offset];
            const cy = data[offset + 1];
            const w = data[offset + 2];
            const h = data[offset + 3];
            const score = data[offset + 4];

            if (score < 0.15) continue;

            detections.push({
                x: cx - w / 2,
                y: cy - h / 2,
                w,
                h,
                confidence: score
            });
        }
    }

    detections.sort((a, b) => b.confidence - a.confidence);
    return detections;
}

async function recognizePlateWithFastPlateOCR(sourceCanvas) {
    const width = 128;
    const height = 64;

    const ocrCanvas = document.createElement("canvas");
    ocrCanvas.width = width;
    ocrCanvas.height = height;

    const ocrCtx = ocrCanvas.getContext("2d");
    ocrCtx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, width, height);

    const imageData = ocrCtx.getImageData(0, 0, width, height);
    const input = new Uint8Array(1 * height * width * 3);

    for (let i = 0; i < height * width; i++) {
        input[i * 3] = imageData.data[i * 4];
        input[i * 3 + 1] = imageData.data[i * 4 + 1];
        input[i * 3 + 2] = imageData.data[i * 4 + 2];
    }

    const tensor = new ort.Tensor("uint8", input, [1, height, width, 3]);

    const outputs = await ocrModel.run({
        [ocrModel.inputNames[0]]: tensor
    });

    const plateOutput = outputs["plate"];

    return decodeFastPlateOCR(plateOutput.data, plateOutput.dims);
}

function decodeFastPlateOCR(data, dims) {
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const blankIndex = 36;

    const seqLen = dims[1];
    const numClasses = dims[2];

    let result = "";

    for (let t = 0; t < seqLen; t++) {
        let maxValue = -Infinity;
        let maxIndex = 0;

        for (let c = 0; c < numClasses; c++) {
            const value = data[t * numClasses + c];

            if (value > maxValue) {
                maxValue = value;
                maxIndex = c;
            }
        }

        if (maxIndex === blankIndex) continue;

        result += chars[maxIndex] || "";
    }

    return result.replace(/[^A-Z0-9]/g, "").toUpperCase().trim();
}

function getRecords() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
}

function saveRecord(record) {
    const records = getRecords();
    records.unshift(record);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function formatConfidence(confidence) {
    if (confidence == null) return "";
    const percent = Math.round(confidence * 100);
    return `<span class="confidence-badge${percent < 60 ? " low" : ""}">${percent}%</span>`;
}

function renderRecords() {
    const records = getRecords();

    if (records.length === 0) {
        recordsList.innerHTML = `
            <div class="empty-records">
                <i class="bi bi-inbox"></i>
                <p>No scans yet</p>
                <small>Captured plates will appear here temporarily</small>
            </div>
        `;
        return;
    }

    recordsList.innerHTML = records.map((r, i) => `
        <div class="record-item">
            <img src="${r.croppedImage}" alt="Plate ${r.plate}">

            <div>
                <div class="record-plate font-monospace">
                    ${r.plate}
                    ${r.confidence != null ? formatConfidence(r.confidence) : ""}
                </div>
                <div class="record-date">${r.date} | ${r.response_time} Sec</div>
            </div>

            <button class="btn btn-sm btn-outline-danger record-delete" onclick="deleteRecord(${i})">
                <i class="bi bi-trash"></i>
            </button>
        </div>
    `).join("");
}

function deleteRecord(index) {
    if (!confirm("Delete this record?")) return;

    const records = getRecords();
    records.splice(index, 1);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    renderRecords();
}

exportPdfBtn.addEventListener("click", () => {
    const records = getRecords();

    if (records.length === 0) {
        showToast("No records to export yet.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();

    let y = 15;

    pdf.setFontSize(18);
    pdf.text("License Plate Records", 14, y);
    y += 12;

    records.forEach((r, i) => {
        if (y > 250) {
            pdf.addPage();
            y = 15;
        }

        const confidenceText = r.confidence != null
            ? ` (${Math.round(r.confidence * 100)}%)`
            : "";

        pdf.setFontSize(12);
        pdf.text(`${i + 1}. Plate: ${r.plate}${confidenceText}`, 14, y);
        pdf.text(`Date: ${r.date}`, 14, y + 7);

        pdf.addImage(r.croppedImage, "JPEG", 140, y - 5, 50, 25);

        y += 38;
    });

    pdf.save("plate-records.pdf");
});

clearBtn.addEventListener("click", () => {
    if (!confirm("Clear all records?")) return;

    localStorage.removeItem(STORAGE_KEY);
    renderRecords();
});
