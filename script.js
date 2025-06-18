document.addEventListener('DOMContentLoaded', () => {
    // === 1. DOM ELEMENTS & STATE MANAGEMENT ===
    const elements = {
        loadingOverlay: document.getElementById('loading-overlay'),
        loadingText: document.getElementById('loading-text'),
        cameraModal: document.getElementById('camera-modal'),
        modalTitle: document.getElementById('modal-title'),
        cameraView: document.getElementById('camera-view'),
        cameraCanvas: document.getElementById('camera-canvas'),
        realTimeOverlay: document.getElementById('real-time-overlay'),
        modalStatus: document.getElementById('modal-status'),
        captureBtn: document.getElementById('capture-btn'),
        usePhotoBtn: document.getElementById('use-photo-btn'),
        cancelCameraBtn: document.getElementById('cancel-camera-btn'),
        profileModal: document.getElementById('profile-modal'),
        profileModalTitle: document.getElementById('profile-modal-title'),
        profileModalBody: document.getElementById('profile-modal-body'),
        closeProfileBtn: document.getElementById('close-profile-btn'),
        themeToggle: document.getElementById('theme-toggle'),
        voiceCommandBtn: document.getElementById('voice-command-btn'),
        tabLinks: document.querySelectorAll('.tab-link'),
        tabContents: document.querySelectorAll('.tab-content'),
        personNameInput: document.getElementById('person-name'),
        addFromCameraBtn: document.getElementById('add-from-camera-btn'),
        knownFaceFile: document.getElementById('known-face-file'),
        knownFacesList: document.getElementById('known-faces-list'),
        imagesToRecognize: document.getElementById('images-to-recognize'),
        recognizeFromCameraBtn: document.getElementById('recognize-from-camera-btn'),
        imagePreview: document.getElementById('image-preview'),
        recognizeBtn: document.getElementById('recognize-btn'),
        realTimeBtn: document.getElementById('real-time-btn'),
        resultsSection: document.getElementById('results-section'),
        resultsDiv: document.getElementById('results'),
        historyGrid: document.getElementById('history-grid'),
        historyPlaceholder: document.getElementById('history-placeholder'),
        compareImg1: document.getElementById('compare-img-1'),
        compareImg2: document.getElementById('compare-img-2'),
        compareFile1: document.getElementById('compare-file-1'),
        compareFile2: document.getElementById('compare-file-2'),
        compareBtn: document.getElementById('compare-btn'),
        compareResultDiv: document.getElementById('compare-result'),
    };

    let state = {
        db: null,
        worker: new Worker('worker.js'),
        knownPeople: [],
        filesToRecognize: [],
        isRealTimeActive: false,
        realTimeDebounceTimer: null,
        cameraPurpose: '',
        activeTab: 'tab-analysis',
        pendingHashes: new Map(),
    };
    
    const { jsPDF } = window.jspdf;

    // === 2. INITIALIZATION & SETUP ===
    function init() {
        showLoading("Đang khởi tạo ứng dụng...");
        setupEventListeners();
        setupTheme();
        setupDB();
        setupWorker();
        hideLoading();
    }

    function setupEventListeners() {
        elements.themeToggle.addEventListener('change', handleThemeToggle);
        elements.voiceCommandBtn.addEventListener('click', startVoiceRecognition);
        elements.tabLinks.forEach(tab => tab.addEventListener('click', handleTabClick));
        elements.knownFacesList.addEventListener('click', handleKnownFacesClick);
        elements.addFromCameraBtn.addEventListener('click', () => openCamera('add_known'));
        elements.knownFaceFile.addEventListener('change', handleAddKnownFile);
        elements.recognizeFromCameraBtn.addEventListener('click', () => openCamera('recognize'));
        elements.imagesToRecognize.addEventListener('change', handleRecognizeFiles);
        elements.recognizeBtn.addEventListener('click', handleBatchAnalysis);
        elements.realTimeBtn.addEventListener('click', () => handleRealTimeToggle(null));
        elements.cancelCameraBtn.addEventListener('click', closeCamera);
        elements.captureBtn.addEventListener('click', capturePhoto);
        elements.usePhotoBtn.addEventListener('click', useCapturedPhoto);
        elements.closeProfileBtn.addEventListener('click', () => elements.profileModal.classList.add('hidden'));
        elements.compareFile1.addEventListener('change', (e) => handleCompareFileSelect(e, 1));
        elements.compareFile2.addEventListener('change', (e) => handleCompareFileSelect(e, 2));
        elements.compareBtn.addEventListener('click', handleCompareFaces);
        elements.historyGrid.addEventListener('click', handleHistoryClick);
    }

    function setupTheme() {
        const savedTheme = localStorage.getItem('darkMode') === 'true';
        elements.themeToggle.checked = savedTheme;
        document.body.classList.toggle('dark-mode', savedTheme);
    }

    // === 3. FEATURE: DATABASE (IndexedDB for History & Known People) ===
    function setupDB() {
        const request = indexedDB.open('AIAnalysisDB', 2);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('knownPeople')) db.createObjectStore('knownPeople', { keyPath: 'name' });
            if (!db.objectStoreNames.contains('analysisHistory')) {
                const historyStore = db.createObjectStore('analysisHistory', { keyPath: 'id' });
                historyStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
        request.onsuccess = event => {
            state.db = event.target.result;
            loadKnownPeople();
            loadHistory();
        };
        request.onerror = event => console.error("Lỗi IndexedDB:", event.target.errorCode);
    }

    function dbPromise(storeName, mode, callback) {
        return new Promise((resolve, reject) => {
            if (!state.db) return reject("Database not initialized");
            const transaction = state.db.transaction(storeName, mode);
            callback(transaction.objectStore(storeName), resolve, reject);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    const db = {
        put: (storeName, data) => dbPromise(storeName, 'readwrite', (store, resolve) => store.put(data).onsuccess = resolve),
        get: (storeName, key) => dbPromise(storeName, 'readonly', (store, resolve) => store.get(key).onsuccess = e => resolve(e.target.result)),
        getAll: (storeName) => dbPromise(storeName, 'readonly', (store, resolve) => store.getAll().onsuccess = e => resolve(e.target.result)),
        delete: (storeName, key) => dbPromise(storeName, 'readwrite', (store, resolve) => store.delete(key).onsuccess = resolve),
    };

    // === 4. FEATURE: WEB WORKER & CACHING ===
    function setupWorker() {
        state.worker.onmessage = event => {
            const { id, hash, error } = event.data;
            const promiseCallbacks = state.pendingHashes.get(id);
            if (promiseCallbacks) {
                error ? promiseCallbacks.reject(error) : promiseCallbacks.resolve(hash);
                state.pendingHashes.delete(id);
            }
        };
    }

    function getImageHash(base64) {
        return new Promise((resolve, reject) => {
            const id = crypto.randomUUID();
            state.pendingHashes.set(id, { resolve, reject });
            state.worker.postMessage({ id, base64 });
        });
    }

    // === 5. UI & TABS & MODALS ===
    function handleTabClick(e) {
        const targetTab = e.currentTarget.dataset.tab;
        elements.tabLinks.forEach(link => link.classList.toggle('active', link.dataset.tab === targetTab));
        elements.tabContents.forEach(content => content.classList.toggle('active', content.id === targetTab));
    }

    function showLoading(text = "Đang xử lý...") {
        elements.loadingText.textContent = text;
        elements.loadingOverlay.classList.remove('hidden');
    }

    function hideLoading() {
        elements.loadingOverlay.classList.add('hidden');
    }

    function handleThemeToggle(e) {
        localStorage.setItem('darkMode', e.target.checked);
        document.body.classList.toggle('dark-mode', e.target.checked);
    }
    
    // === 6. KNOWN PEOPLE MANAGEMENT ===
    async function loadKnownPeople() {
        state.knownPeople = await db.getAll('knownPeople') || [];
        renderKnownFacesList();
    }

    function renderKnownFacesList() {
        elements.knownFacesList.innerHTML = '';
        state.knownPeople.forEach(person => {
            const personDiv = document.createElement('div');
            personDiv.className = 'image-item';
            personDiv.dataset.name = person.name;
            personDiv.title = `Xem profile của ${person.name}`;
            personDiv.innerHTML = `<img src="${person.imageBase64Url}" alt="${person.name}"><p>${person.name}</p><span class="delete-btn" data-name="${person.name}" title="Xóa người này">×</span>`;
            elements.knownFacesList.appendChild(personDiv);
        });
    }

    async function handleAddKnownFile(e) {
        const file = e.target.files[0];
        const name = elements.personNameInput.value.trim();
        if (!name || !file) return alert('Vui lòng nhập tên và chọn tệp!');
        await addPerson(name, file);
        e.target.value = '';
    }

    async function addPerson(name, file) {
        if (state.knownPeople.some(p => p.name.toLowerCase() === name.toLowerCase())) return alert(`Tên "${name}" đã tồn tại.`);
        showLoading("Đang xử lý ảnh...");
        const imageBase64Url = await fileToDataURL(file);
        await db.put('knownPeople', { name, imageBase64Url });
        await loadKnownPeople();
        elements.personNameInput.value = '';
        hideLoading();
    }

    async function handleKnownFacesClick(e) {
        const item = e.target.closest('.image-item');
        if (!item) return;
        const name = item.dataset.name;
        if (e.target.classList.contains('delete-btn')) {
            e.stopPropagation();
            if (confirm(`Bạn có chắc muốn xóa "${name}"?`)) {
                await db.delete('knownPeople', name);
                await loadKnownPeople();
            }
        } else {
            showProfile(name);
        }
    }
    
    // === 7. CAMERA & MODALS ===
    async function openCamera(purpose) {
        state.cameraPurpose = purpose;
        const isRealTime = purpose === 'real_time';
        elements.modalTitle.textContent = isRealTime ? 'Nhận diện Real-time' : 'Chụp ảnh';
        elements.captureBtn.classList.toggle('hidden', isRealTime);
        elements.usePhotoBtn.classList.add('hidden');
        elements.realTimeOverlay.classList.toggle('hidden', !isRealTime);
        elements.modalStatus.textContent = '';
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 } } });
            elements.cameraView.srcObject = stream;
            elements.cameraModal.classList.remove('hidden');
            if (isRealTime) handleRealTimeToggle(true);
        } catch (err) { alert("Lỗi camera: " + err.message); }
    }

    function closeCamera() {
        if (elements.cameraView.srcObject) {
            elements.cameraView.srcObject.getTracks().forEach(track => track.stop());
            elements.cameraView.srcObject = null;
        }
        if (state.isRealTimeActive) handleRealTimeToggle(false);
        elements.cameraModal.classList.add('hidden');
    }

    function capturePhoto() {
        const context = elements.cameraCanvas.getContext('2d');
        elements.cameraCanvas.width = elements.cameraView.videoWidth;
        elements.cameraCanvas.height = elements.cameraView.videoHeight;
        context.drawImage(elements.cameraView, 0, 0);
        elements.cameraView.srcObject.getTracks().forEach(track => track.stop());
        elements.cameraView.srcObject = null;
        elements.usePhotoBtn.classList.remove('hidden');
        elements.captureBtn.classList.add('hidden');
    }

    async function useCapturedPhoto() {
        const file = await canvasToFile(elements.cameraCanvas, `capture.jpg`);
        if (state.cameraPurpose === 'add_known') {
            const name = elements.personNameInput.value.trim();
            if (!name) return alert('Vui lòng nhập tên!');
            await addPerson(name, file);
        } else if (state.cameraPurpose === 'recognize') {
            state.filesToRecognize.push(file);
            renderImagePreviews();
        }
        closeCamera();
    }

    // === 8. ANALYSIS LOGIC & SECURE API CALL ===
    async function callGeminiAPI(parts) {
        // API Key không còn ở đây. Nó được xử lý bởi Netlify Function.
        const API_URL = '/api/analyze'; // URL tương đối trỏ đến function của bạn

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parts })
        });
        
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `Lỗi server: ${response.statusText}`);
        }

        if (!data.candidates || !data.candidates[0].content) {
            throw new Error("Phản hồi từ API không hợp lệ.");
        }
        return JSON.parse(data.candidates[0].content.parts[0].text);
    }
    
    function buildAnalysisPrompt(imageCount) {
        const promptCore = `Bạn là hệ thống phân tích hình ảnh đa năng. Nhiệm vụ của bạn là phân tích các hình ảnh được cung cấp.
        ĐẦU VÀO: Một danh sách ảnh tham chiếu của người đã biết, và ${imageCount} ảnh cần phân tích.
        YÊU CẦU:
        1. Với MỖI ảnh cần phân tích, hãy xác định TẤT CẢ các khuôn mặt trong ảnh.
        2. Với mỗi khuôn mặt: so sánh với danh sách tham chiếu, nếu khớp trả về tên, nếu không trả về "Người lạ". Ước tính cảm xúc (Vui, Buồn, Ngạc nhiên, Giận dữ, Trung tính), tuổi (ví dụ: 20-25), và giới tính (Nam, Nữ). Xác định tọa độ hộp bao (bounding box) tương đối (giá trị từ 0.0 đến 1.0).
        3. Sau khi phân tích tất cả khuôn mặt trong một ảnh, viết một câu mô tả ngắn gọn về toàn bộ bối cảnh (scene description).
        
        ĐỊNH DẠNG ĐẦU RA (JSON BẮT BUỘC):`;

        const formatDescription = imageCount > 1 ?
            `Trả về một đối tượng JSON. Các khóa là "image_0", "image_1",... Mỗi giá trị là một đối tượng chứa hai khóa: "analysis" (một MẢNG các đối tượng người) và "scene_description" (một chuỗi).` :
            `Trả về một đối tượng JSON duy nhất chứa hai khóa: "analysis" (một MẢNG các đối tượng người) và "scene_description" (một chuỗi).`;

        const personStructure = `Cấu trúc đối tượng MỖI người:
        {"person_name": "...", "emotion": "...", "estimated_age": "...", "estimated_gender": "...", "bounding_box": {"x": 0.25, "y": 0.1, "width": 0.5, "height": 0.6}}`;

        return `${promptCore}\n${formatDescription}\n\n${personStructure}`;
    }
    
    function handleRecognizeFiles(e) {
        state.filesToRecognize.push(...Array.from(e.target.files));
        renderImagePreviews();
        e.target.value = '';
    }

    function renderImagePreviews() {
        elements.imagePreview.innerHTML = '';
        state.filesToRecognize.forEach(file => {
            const previewDiv = document.createElement('div');
            previewDiv.className = 'image-item';
            previewDiv.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Preview">`;
            elements.imagePreview.appendChild(previewDiv);
        });
    }

    async function handleBatchAnalysis() {
        if (!state.filesToRecognize.length) return alert("Vui lòng chọn ảnh để phân tích.");
        showLoading("Chuẩn bị và cache ảnh...");
        elements.resultsSection.classList.add('hidden');
        elements.resultsDiv.innerHTML = '';

        try {
            let analysisQueue = [];
            for (const file of state.filesToRecognize) {
                const base64Url = await fileToDataURL(file);
                const hash = await getImageHash(base64Url.split(',')[1]);
                const cachedResult = sessionStorage.getItem(hash);
                if (cachedResult) {
                    const resultData = JSON.parse(cachedResult);
                    await saveHistory(resultData);
                    displayResult(resultData);
                } else {
                    analysisQueue.push({ base64Url, mime_type: file.type, hash });
                }
            }

            if (analysisQueue.length > 0) {
                showLoading(`Đang phân tích ${analysisQueue.length} ảnh...`);
                const promptInstruction = buildAnalysisPrompt(analysisQueue.length);
                const parts = [
                    { text: promptInstruction },
                    { text: "\n--- DỮ LIỆU THAM CHIẾU ---" },
                    ...state.knownPeople.flatMap(p => [{ text: `THAM CHIẾU CHO: ${p.name}` }, { inline_data: { mime_type: 'image/jpeg', data: p.imageBase64Url.split(',')[1] } }]),
                    { text: "\n--- ẢNH CẦN PHÂN TÍCH ---" },
                    ...analysisQueue.flatMap((item, index) => [{ text: `PHÂN TÍCH ẢNH (image_${index}):` }, { inline_data: { mime_type: item.mime_type, data: item.base64Url.split(',')[1] } }])
                ];
                const batchResult = await callGeminiAPI(parts);

                for (const key in batchResult) {
                    if (key.startsWith('image_')) {
                        const index = parseInt(key.split('_')[1]);
                        const item = analysisQueue[index];
                        const analysisData = batchResult[key];
                        const resultData = { id: crypto.randomUUID(), timestamp: Date.now(), imageBase64Url: item.base64Url, ...analysisData };
                        sessionStorage.setItem(item.hash, JSON.stringify(resultData));
                        await saveHistory(resultData);
                        displayResult(resultData);
                    }
                }
            }
            elements.resultsSection.classList.remove('hidden');
            state.filesToRecognize = [];
            renderImagePreviews();
        } catch (error) {
            alert("Lỗi phân tích: " + error.message);
        } finally {
            hideLoading();
        }
    }

    // === 9. REAL-TIME ANALYSIS (DEBOUNCED) ===
    function handleRealTimeToggle(forceStart = null) {
        const shouldBeActive = forceStart !== null ? forceStart : !state.isRealTimeActive;
        state.isRealTimeActive = shouldBeActive;
        elements.realTimeBtn.innerHTML = shouldBeActive ? `<i class="fa-solid fa-stop"></i> Dừng` : `<i class="fa-solid fa-bolt"></i> Real-time`;
        elements.realTimeBtn.classList.toggle('active', shouldBeActive);
        if (shouldBeActive) {
            if (!state.knownPeople.length) {
                alert("Cần có người trong CSDL để nhận diện real-time.");
                handleRealTimeToggle(false);
                return;
            }
            realTimeLoop();
        } else {
            if (state.realTimeDebounceTimer) clearTimeout(state.realTimeDebounceTimer);
        }
    }

    function realTimeLoop() {
        if (!state.isRealTimeActive) return;
        if (state.realTimeDebounceTimer) clearTimeout(state.realTimeDebounceTimer);
        state.realTimeDebounceTimer = setTimeout(async () => {
            if (!state.isRealTimeActive) return;
            elements.modalStatus.textContent = 'Đang chụp & phân tích...';
            const context = elements.cameraCanvas.getContext('2d');
            elements.cameraCanvas.width = elements.cameraView.videoWidth;
            elements.cameraCanvas.height = elements.cameraView.videoHeight;
            context.drawImage(elements.cameraView, 0, 0);
            const base64 = elements.cameraCanvas.toDataURL('image/jpeg').split(',')[1];
            try {
                const prompt = buildAnalysisPrompt(1);
                const parts = [
                    { text: prompt },
                    ...state.knownPeople.flatMap(p => [{ text: `THAM CHIẾU: ${p.name}` }, { inline_data: { mime_type: 'image/jpeg', data: p.imageBase64Url.split(',')[1] } }]),
                    { text: `PHÂN TÍCH ẢNH NÀY:` }, { inline_data: { mime_type: 'image/jpeg', data: base64 } }
                ];
                const result = await callGeminiAPI(parts);
                drawRealTimeOverlay(result.analysis || []);
                elements.modalStatus.textContent = result.scene_description || 'Phân tích xong. Chờ...';
            } catch (e) {
                elements.modalStatus.textContent = "Lỗi: " + e.message.slice(0, 30) + "...";
            } finally {
                realTimeLoop();
            }
        }, 1500);
    }
    
    function drawRealTimeOverlay(detectedPeople) {
        elements.realTimeOverlay.innerHTML = '';
        if (!Array.isArray(detectedPeople)) return;
        detectedPeople.forEach(person => {
            if (!person.bounding_box) return;
            const { x, y, width, height } = person.bounding_box;
            const box = document.createElement('div');
            box.className = 'bounding-box';
            Object.assign(box.style, { left: `${x*100}%`, top: `${y*100}%`, width: `${width*100}%`, height: `${height*100}%` });
            const isStranger = person.person_name.toLowerCase() === 'người lạ';
            const color = isStranger ? 'var(--danger-color)' : 'var(--success-color)';
            box.style.borderColor = color;
            box.innerHTML = `<div class="box-label" style="background-color:${color}">${person.person_name} (${person.emotion || '?'})</div>`;
            elements.realTimeOverlay.appendChild(box);
        });
    }

    // === 10. FACE COMPARE ===
    function handleCompareFileSelect(e, num) {
        const file = e.target.files[0];
        if (file) fileToDataURL(file).then(url => elements[`compareImg${num}`].src = url);
    }

    async function handleCompareFaces() {
        const file1 = elements.compareFile1.files[0];
        const file2 = elements.compareFile2.files[0];
        if (!file1 || !file2) return alert("Vui lòng chọn đủ 2 ảnh.");
        showLoading("Đang so sánh...");
        try {
            const [base64_1, base64_2] = await Promise.all([fileToDataURL(file1), fileToDataURL(file2)]);
            const parts = [
                { text: `Bạn là chuyên gia so sánh khuôn mặt. Hãy so sánh hai khuôn mặt trong hai ảnh này. Trả lời bằng JSON: {"same_person": boolean, "similarity_score": number (0-100), "reasoning": "..."}` },
                { text: `Ảnh 1:` }, { inline_data: { mime_type: file1.type, data: base64_1.split(',')[1] } },
                { text: `Ảnh 2:` }, { inline_data: { mime_type: file2.type, data: base64_2.split(',')[1] } }
            ];
            const result = await callGeminiAPI(parts);
            elements.compareResultDiv.innerHTML = `<h3>Kết quả: ${result.same_person ? "Cùng một người" : "Hai người khác nhau"}</h3><p><strong>Điểm tương đồng:</strong> ${result.similarity_score}%</p><p><strong>Lý do:</strong> ${result.reasoning}</p>`;
            elements.compareResultDiv.classList.remove('hidden');
        } catch (error) {
            alert("Lỗi so sánh: " + error.message);
        } finally {
            hideLoading();
        }
    }

    // === 11. PROFILE & HISTORY ===
    async function loadHistory() {
        const history = await db.getAll('analysisHistory') || [];
        elements.historyPlaceholder.classList.toggle('hidden', history.length > 0);
        elements.historyGrid.innerHTML = '';
        history.sort((a,b) => b.timestamp - a.timestamp).forEach(displayHistoryItem);
    }
    
    async function saveHistory(resultData) {
        await db.put('analysisHistory', resultData);
        await loadHistory();
    }
    
    function displayResult(resultData) {
        const card = createResultCard(resultData);
        elements.resultsDiv.prepend(card);
    }

    function displayHistoryItem(itemData) {
        const card = createResultCard(itemData, true);
        elements.historyGrid.appendChild(card);
    }

    function createResultCard(data, isHistory = false) {
        const card = document.createElement('div');
        card.className = isHistory ? 'history-item' : 'result-card';
        card.dataset.id = data.id;
        const peopleList = (data.analysis || []).map(p => {
            const nameClass = p.person_name.toLowerCase() === 'người lạ' ? 'stranger' : 'known';
            return `<p><strong class="${nameClass}">${p.person_name}</strong>: ${p.emotion || 'N/A'}, ~${p.estimated_age || 'N/A'} tuổi</p>`;
        }).join('');
        card.innerHTML = `
            <div class="result-image-container"><img src="${data.imageBase64Url}" alt="Kết quả phân tích"></div>
            <div class="result-info">
                <h4>${isHistory ? new Date(data.timestamp).toLocaleString('vi-VN') : 'Phân tích mới'}</h4>
                ${peopleList}
                <p><strong>Bối cảnh:</strong> ${data.scene_description || 'Không có'}</p>
            </div>`;
        const img = card.querySelector('img');
        img.onload = () => {
            (data.analysis || []).forEach(p => {
                if (!p.bounding_box) return;
                const { x, y, width, height } = p.bounding_box;
                const box = document.createElement('div');
                box.className = 'bounding-box';
                Object.assign(box.style, { left: `${x*100}%`, top: `${y*100}%`, width: `${width*100}%`, height: `${height*100}%` });
                const color = p.person_name.toLowerCase() === 'người lạ' ? 'var(--danger-color)' : 'var(--success-color)';
                box.style.borderColor = color;
                box.innerHTML = `<div class="box-label" style="background-color:${color}">${p.person_name}</div>`;
                img.parentElement.appendChild(box);
            });
        };
        return card;
    }

    async function showProfile(name) {
        showLoading(`Đang tải profile của ${name}...`);
        elements.profileModalTitle.textContent = `Profile: ${name}`;
        const allHistory = await db.getAll('analysisHistory');
        const personHistory = allHistory
            .filter(item => (item.analysis || []).some(p => p.person_name === name))
            .sort((a,b) => b.timestamp - a.timestamp);
        let bodyHtml = `<p>Tìm thấy ${personHistory.length} lần xuất hiện trong lịch sử.</p><div class="history-grid">`;
        if (personHistory.length > 0) {
            personHistory.forEach(item => bodyHtml += createResultCard(item, true).outerHTML);
        }
        bodyHtml += '</div>';
        elements.profileModalBody.innerHTML = bodyHtml;
        elements.profileModal.classList.remove('hidden');
        hideLoading();
    }
    
    function handleHistoryClick(e) {
        const item = e.target.closest('.history-item');
        if (!item) return;
        const id = item.dataset.id;
        const action = prompt(`Hành động cho mục này (ID: ...${id.slice(-6)}):\n1. Xóa\n2. Xuất PDF`);
        if (action === '1') {
            if (confirm("Bạn có chắc muốn xóa vĩnh viễn mục này?")) db.delete('analysisHistory', id).then(loadHistory);
        } else if (action === '2') {
            exportResultToPDF(id);
        }
    }

    // === 12. VOICE COMMANDS ===
    function startVoiceRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return alert("Trình duyệt của bạn không hỗ trợ nhận dạng giọng nói.");
        
        const recognition = new SpeechRecognition();
        recognition.lang = 'vi-VN';
        recognition.interimResults = false;
        
        elements.voiceCommandBtn.classList.add('listening');
        
        recognition.onresult = event => {
            const command = event.results[0][0].transcript.toLowerCase().trim();
            alert(`Đã nhận lệnh: "${command}"`);
            // Xử lý lệnh ở đây, ví dụ:
            if (command.includes("phân tích")) elements.recognizeBtn.click();
            else if (command.includes("chụp ảnh")) elements.recognizeFromCameraBtn.click();
            else if (command.includes("lịch sử")) elements.tabLinks[1].click();
        };
        
        recognition.onerror = event => alert("Lỗi nhận dạng giọng nói: " + event.error);
        recognition.onend = () => elements.voiceCommandBtn.classList.remove('listening');
        
        recognition.start();
    }

    // === 13. EXPORT TO PDF ===
    async function exportResultToPDF(resultId) {
        showLoading("Đang tạo PDF...");
        const data = await db.get('analysisHistory', resultId);
        if (!data) return alert("Không tìm thấy kết quả.");

        const doc = new jsPDF();
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(18);
        doc.text("Báo cáo Phân tích Hình ảnh AI", 105, 15, { align: 'center' });
        doc.setFontSize(12);
        doc.text(`ID: ${data.id}`, 10, 25);
        doc.text(`Thời gian: ${new Date(data.timestamp).toLocaleString('vi-VN')}`, 10, 32);

        doc.addImage(data.imageBase64Url, 'JPEG', 10, 40, 180, 100, 'alias', 'FAST');
        
        let yPos = 150;
        doc.setFontSize(14);
        doc.text("Kết quả Phân tích:", 10, yPos);
        yPos += 8;
        
        doc.setFontSize(10);
        (data.analysis || []).forEach(p => {
            doc.text(`- Tên: ${p.person_name} (Cảm xúc: ${p.emotion}, Tuổi: ~${p.estimated_age}, Giới tính: ${p.estimated_gender})`, 15, yPos);
            yPos += 7;
        });

        yPos += 5;
        doc.setFontSize(12);
        doc.text("Mô tả Bối cảnh:", 10, yPos);
        yPos += 7;
        doc.setFontSize(10);
        const sceneLines = doc.splitTextToSize(data.scene_description || 'Không có', 180);
        doc.text(sceneLines, 15, yPos);
        
        doc.save(`analysis-report-${resultId.slice(0, 8)}.pdf`);
        hideLoading();
    }

    // === UTILITY FUNCTIONS ===
    const fileToDataURL = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
    });

    const canvasToFile = (canvas, filename) => new Promise(resolve => {
        canvas.toBlob(blob => resolve(new File([blob], filename, { type: 'image/jpeg' })), 'image/jpeg');
    });

    // === KICKSTART THE APP ===
    init();
});
