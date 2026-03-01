const API = "http://192.168.1.49:8000";
let ws = null, stream = null, camInterval = null;


// ===== TABS =====
function switchTab(name, btn) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + name).classList.add('active');
    if (name === 'history') loadHistory();
    if (name === 'student') {
        loadStudents();
        document.getElementById('avatar-file').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const preview = document.getElementById('avatar-preview');
                preview.src = ev.target.result;
                preview.style.display = 'block';
            };
            reader.readAsDataURL(file);
        });
    }
    if (name === 'camera') loadCameraList();  // ← thêm dòng này
}

// Preview avatar khi chọn ảnh (chỉ gắn 1 lần)
document.getElementById('avatar-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const preview = document.getElementById('avatar-preview');
        preview.src = ev.target.result;
        preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
});

// ===== UPLOAD =====
document.getElementById('fileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    document.getElementById('upload-results').innerHTML = '<p>⏳ Đang xử lý...</p>';

    const res = await fetch(`${API}/api/detect/image`, { method: 'POST', body: formData });
    const data = await res.json();

    document.getElementById('result-img').src = data.result_image;
    document.getElementById('result-img').style.display = 'block';

    if (data.detections.length === 0) {
        document.getElementById('upload-results').innerHTML = '<p style="color:red;">Không tìm thấy biển số</p>';
        return;
    }

    document.getElementById('upload-results').innerHTML = data.detections.map(d => `
        <div class="result-box">
            <div class="plate-text">${d.plate_text}</div>
            <p style="margin-top:8px; color:#555; font-size:0.85rem;">
                Detect: ${(d.detect_confidence * 100).toFixed(1)}% &nbsp;|&nbsp;
                OCR: ${(d.ocr_confidence * 100).toFixed(1)}%
            </p>
            ${d.student ? `
            <div class="student-info" style="display:flex; gap:12px; align-items:center; margin-top:10px;">
                <img src="${d.student.avatar || 'static/default-avatar.png'}" 
                    style="width:60px;height:60px;border-radius:50%;object-fit:cover;">
                <div>
                    <p>🎓 <b>${d.student.ho_ten}</b></p>
                    <p>MSSV: ${d.student.mssv}</p>
                    <p>Lớp: ${d.student.lop}</p>
                </div>
            </div>` : '<p style="color:#aaa; font-size:0.85rem; margin-top:8px;">Không tìm thấy sinh viên</p>'}
    `).join('');
});

// Load danh sách camera
async function loadCameraList() {
    try {
        await navigator.mediaDevices.getUserMedia({ video: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(d => d.kind === 'videoinput');
        const select = document.getElementById('camera-select');
        select.innerHTML = cameras.map((cam, i) => `
            <option value="${cam.deviceId}">${cam.label || `Camera ${i + 1}`}</option>
        `).join('');
    } catch (err) {
        console.error('Không lấy được danh sách camera:', err);
    }
}

// ===== CAMERA =====
async function startCamera() {
    const deviceId = document.getElementById('camera-select').value;
    const constraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    const video = document.getElementById('video');
    video.srcObject = stream;
    video.style.display = 'block';
    document.getElementById('camera-result').style.display = 'none';

    ws = new WebSocket(`ws://192.168.1.49:8000/ws/camera`);

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        document.getElementById('camera-result').src = data.frame;
        document.getElementById('camera-result').style.display = 'block';
        video.style.display = 'none';

        if (data.detections.length > 0) {
            document.getElementById('camera-results').innerHTML = data.detections.map(d => `
                <div class="result-box">
                    <div class="plate-text">${d.plate_text}</div>
                    <p style="margin-top:8px; color:#555; font-size:0.85rem;">
                        Confidence: ${(d.detect_confidence * 100).toFixed(1)}%
                        &nbsp;|&nbsp; ${d.event_type === 'vào' ? '🟢 Vào' : '🔴 Ra'}
                    </p>
                    ${d.student ? `
                    <div class="student-info" style="display:flex; gap:12px; align-items:center; margin-top:10px;">
                        <img src="${d.student.avatar || 'static/default-avatar.png'}" 
                            style="width:60px;height:60px;border-radius:50%;object-fit:cover;">
                        <div>
                            <p>🎓 <b>${d.student.ho_ten}</b></p>
                            <p>MSSV: ${d.student.mssv}</p>
                            <p>Lớp: ${d.student.lop}</p>
                        </div>
                    </div>` : ''}
                </div>
            `).join('');
        }
    };

    const canvas = document.getElementById('canvas');
    camInterval = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        ws.send(canvas.toDataURL('image/jpeg', 0.7));
    }, 300);
}

function stopCamera() {
    clearInterval(camInterval);
    if (ws) ws.close();
    if (stream) stream.getTracks().forEach(t => t.stop());
    document.getElementById('video').style.display = 'none';
    document.getElementById('camera-result').style.display = 'none';
}

// ===== LỊCH SỬ =====
async function loadHistory() {
    const filterTime = document.getElementById('filter-time')?.value || '';
    const eventType = document.getElementById('filter-event')?.value || '';

    let url = `${API}/api/history?limit=100`;
    if (eventType) url += `&event_type=${encodeURIComponent(eventType)}`;
    if (filterTime) url += `&filter_by=${filterTime}`;

    const res = await fetch(url);
    const data = await res.json();

    document.getElementById('history-body').innerHTML = data.length === 0
        ? '<tr><td colspan="8" style="text-align:center;color:#aaa;">Không có dữ liệu</td></tr>'
        : data.map(r => `
        <tr>
            <td>${r.id}</td>
            <td><b>${r.plate_text}</b></td>
            <td>${r.confidence}%</td>
            <td>${r.event_type === 'vào' ? '🟢 Vào' : '🔴 Ra'}</td>
            <td>${r.source === 'upload' ? '📷 Upload' : '🎥 Camera'}</td>
            <td>${r.detected_at}</td>
            <td><button class="btn-primary" style="padding:4px 12px;font-size:0.8rem;" 
                onclick="viewHistory('${r.plate_text}')">👁 Xem</button></td>
            <td><button class="btn-del" onclick="deleteRecord(${r.id})">🗑 Xóa</button></td>
        </tr>
    `).join('');
}

async function deleteRecord(id) {
    await fetch(`${API}/api/history/${id}`, { method: 'DELETE' });
    loadHistory();
}

// ===== SINH VIÊN =====
async function saveStudent() {
    const id = document.getElementById('edit-id').value;
    const data = {
        mssv: document.getElementById('mssv').value,
        ho_ten: document.getElementById('ho_ten').value,
        lop: document.getElementById('lop').value,
        bien_so_xe: document.getElementById('bien_so').value.toUpperCase().replace(/-/g,'').replace(/\./g,'')
    };

    if (!data.mssv || !data.ho_ten || !data.bien_so_xe) {
        document.getElementById('add-msg').innerHTML = '<span style="color:red;">Vui lòng điền đầy đủ!</span>';
        return;
    }

    let studentId = id;

    if (id) {
        await fetch(`${API}/api/student/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        document.getElementById('add-msg').innerHTML = '<span style="color:green;">✅ Đã cập nhật!</span>';
    } else {
        const res = await fetch(`${API}/api/student`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const newStudent = await res.json();
        studentId = newStudent.id;
        document.getElementById('add-msg').innerHTML = '<span style="color:green;">✅ Đã thêm thành công!</span>';
    }

    // Upload avatar nếu có
    const avatarFile = document.getElementById('avatar-file').files[0];
    if (avatarFile && studentId) {
        const formData = new FormData();
        formData.append('file', avatarFile);
        await fetch(`${API}/api/student/${studentId}/avatar`, {
            method: 'POST',
            body: formData
        });
    }

    clearForm();
    loadStudents();
}

function editStudent(id, mssv, ho_ten, lop, bien_so) {
    document.getElementById('edit-id').value = id;
    document.getElementById('mssv').value = mssv;
    document.getElementById('ho_ten').value = ho_ten;
    document.getElementById('lop').value = lop;
    document.getElementById('bien_so').value = bien_so;
    document.getElementById('form-title').textContent = '✏️ Sửa sinh viên';
    document.getElementById('btn-save').textContent = '💾 Lưu';
    document.getElementById('btn-cancel').style.display = 'block';
    window.scrollTo(0, 0);
}

function cancelEdit() {
    clearForm();
}

function clearForm() {
    document.getElementById('edit-id').value = '';
    document.getElementById('mssv').value = '';
    document.getElementById('ho_ten').value = '';
    document.getElementById('lop').value = '';
    document.getElementById('bien_so').value = '';
    document.getElementById('avatar-file').value = '';
    document.getElementById('avatar-preview').style.display = 'none';
    document.getElementById('form-title').textContent = '➕ Thêm sinh viên';
    document.getElementById('btn-save').textContent = '➕ Thêm';
    document.getElementById('btn-cancel').style.display = 'none';
}

async function deleteStudent(id, ten) {
    if (!confirm(`Xóa sinh viên "${ten}"?`)) return;
    await fetch(`${API}/api/student/${id}`, { method: 'DELETE' });
    loadStudents();
}

async function loadHistory() {
    const filterTime = document.getElementById('filter-time')?.value || '';
    const eventType = document.getElementById('filter-event')?.value || '';

    let url = `${API}/api/history?limit=100`;
    if (eventType) url += `&event_type=${encodeURIComponent(eventType)}`;
    if (filterTime) url += `&filter_by=${filterTime}`;

    const res = await fetch(url);
    const data = await res.json();

    document.getElementById('history-body').innerHTML = data.length === 0
        ? '<tr><td colspan="8" style="text-align:center;color:#aaa;">Không có dữ liệu</td></tr>'
        : data.map(r => `
        <tr>
            <td>${r.id}</td>
            <td><b>${r.plate_text}</b></td>
            <td>${r.confidence}%</td>
            <td>${r.event_type === 'vào' ? '🟢 Vào' : '🔴 Ra'}</td>
            <td>${r.source === 'upload' ? '📷 Upload' : '🎥 Camera'}</td>
            <td>${r.detected_at}</td>
            <td><button class="btn-primary" style="padding:4px 12px;font-size:0.8rem;" 
                onclick="viewHistory('${r.plate_text}')">👁 Xem</button></td>
            <td><button class="btn-del" onclick="deleteRecord(${r.id})">🗑 Xóa</button></td>
        </tr>
    `).join('');
}

async function searchStudent() {
    const plate = document.getElementById('search-plate').value.toUpperCase().replace(/-/g,'').replace(/\./g,'');
    if (!plate) return;
    const res = await fetch(`${API}/api/student/${plate}`);
    if (res.status === 404) {
        document.getElementById('search-result').innerHTML = '<p style="color:red;">Không tìm thấy sinh viên</p>';
        return;
    }
    const data = await res.json();
    document.getElementById('search-result').innerHTML = `
        <div class="student-info" style="display:flex; gap:15px; align-items:center;">
            <img src="${data.avatar || 'static/default-avatar.png'}" 
                style="width:70px;height:70px;border-radius:50%;object-fit:cover;">
            <div>
                <p>🎓 <b>${data.ho_ten}</b></p>
                <p>MSSV: <b>${data.mssv}</b></p>
                <p>Lớp: ${data.lop}</p>
                <p>Biển số: <b>${data.bien_so_xe}</b></p>
            </div>
        </div>
    `;
}

async function viewHistory(plate) {
    const res = await fetch(`${API}/api/student/${plate}`);
    
    if (res.status === 404) {
        document.getElementById('history-detail').innerHTML = `
            <div style="text-align:center; padding:20px;">
                <p style="font-size:3rem;">🚗</p>
                <p style="font-size:1.2rem; font-weight:bold; margin:8px 0;">${plate}</p>
                <p style="color:#aaa;">Biển số này chưa được đăng ký trong hệ thống</p>
            </div>
        `;
    } else {
        const s = await res.json();
        document.getElementById('history-detail').innerHTML = `
            <div style="display:flex; gap:20px; align-items:center;">
                <img src="${s.avatar || 'static/default-avatar.png'}" 
                    style="width:90px;height:90px;border-radius:50%;object-fit:cover;flex-shrink:0;">
                <div style="line-height:1.8;">
                    <p style="font-size:1.2rem;font-weight:bold;">🎓 ${s.ho_ten}</p>
                    <p>MSSV: <b>${s.mssv}</b></p>
                    <p>Lớp: ${s.lop}</p>
                    <p>Biển số: <b>${s.bien_so_xe}</b></p>
                </div>
            </div>
        `;
    }
    document.getElementById('history-modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('history-modal').style.display = 'none';
}