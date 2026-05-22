const imageInput = document.getElementById("imageInput");
const captureBtn = document.getElementById("captureBtn");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const croppedPlateImg = document.getElementById("croppedPlate");
const plateText = document.getElementById("plateText");
const loading = document.getElementById("loading");
const recordsList = document.getElementById("recordsList");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const clearBtn = document.getElementById("clearBtn");

const STORAGE_KEY = "plate_demo_records";

let detectorModel;
let ocrModel;

loadModels();
renderRecords();

async function loadModels() {
    loading.classList.remove("d-none");
    loading.innerText = "Loading AI models...";

    detectorModel = await ort.InferenceSession.create("./models/best.onnx");
    ocrModel = await ort.InferenceSession.create("./models/cct_s_v2_global.onnx");

    loading.classList.add("d-none");
}

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
        alert("Models are still loading.");
        return;
    }

    loading.classList.remove("d-none");
    loading.innerText = "Processing image...";
    plateText.innerText = "Processing...";
    croppedPlateImg.removeAttribute("src");

    await new Promise(r => setTimeout(r, 100));

    const img = await loadImage(file);
    const result = await processImage(img);

    loading.classList.add("d-none");

    if (!result.success) {
        plateText.innerText = result.error;
        return;
    }

    plateText.innerText = result.plate;

    saveRecord({
        capturedImage: result.capturedImage,
        croppedImage: result.croppedImage,
        plate: result.plate,
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

async function processImage(img) {
    const inputSize = 640;

    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

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
    const detections = parseYoloV8Output(output.data, output.dims);

    if (detections.length === 0) {
        return { success: false, error: "No plate detected" };
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

    ctx.strokeStyle = "red";
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);

    const plate = await recognizePlateWithFastPlateOCR(plateCanvas);

    return {
        success: true,
        plate,
        croppedImage: croppedBase64,
        capturedImage: canvas.toDataURL("image/jpeg", 0.8)
    };
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

function renderRecords() {
    const records = getRecords();

    if (records.length === 0) {
        recordsList.innerHTML = `<p class="text-muted">No records saved yet.</p>`;
        return;
    }

    recordsList.innerHTML = records.map((r, i) => `
        <div class="card mb-2">
            <div class="card-body">
                <div class="row align-items-center g-2">
                    <div class="col-4 col-md-2">
                        <img src="${r.croppedImage}" class="img-fluid border rounded">
                    </div>
                    <div class="col-8 col-md-4">
                        <h4 class="text-success mb-1">${r.plate}</h4>
                        <small class="text-muted">${r.date}</small>
                        <br>
                        <button class="btn btn-sm btn-outline-danger mt-2" onclick="deleteRecord(${i})">
                            Delete
                        </button>
                    </div>
                    <div class="col-md-6">
                        <img src="${r.capturedImage}" class="img-fluid rounded border">
                    </div>
                </div>
            </div>
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
        alert("No records to export.");
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

        pdf.setFontSize(12);
        pdf.text(`${i + 1}. Plate: ${r.plate}`, 14, y);
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
