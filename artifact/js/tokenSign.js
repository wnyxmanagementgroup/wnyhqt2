// ==============================================================
// ระบบลงนามผ่านลิงก์เฉพาะ (Token-Based Signing)
// ผู้ลงนามไม่ต้องเข้าสู่ระบบ — เพียงเปิดลิงก์และเซ็นได้เลย
// ==============================================================

// ตัวแปร global สำหรับ token page
window._currentSignToken     = null;
window._currentSignTokenData = null;
window._currentSignReqData   = null;
window._tokenPdfUrl          = null;
window._tokenPdfBytes        = null;

// --- 1. สร้าง Token ID แบบสุ่ม ---
function _generateTokenId() {
    if (window.crypto && window.crypto.getRandomValues) {
        const arr = new Uint8Array(16);
        window.crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// --- 2. สร้าง Approval Token ใน Firestore และคืนค่า URL ---
async function generateApprovalToken(requestId, nextDocStatus, docMeta) {
    if (typeof db === 'undefined' || !requestId || !nextDocStatus) return null;

    const token  = _generateTokenId();
    const safeId = requestId.replace(/[\/\\:\.]/g, '-');

    try {
        await db.collection('approvalLinks').doc(token).set({
            requestId:  requestId,
            safeId:     safeId,
            docStatus:  nextDocStatus,
            docTitle:   docMeta?.purpose || docMeta?.docTitle || '',
            requester:  docMeta?.requesterName || '',
            createdAt:  firebase.firestore.FieldValue.serverTimestamp(),
            expiresAt:  new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 วัน
            used:       false,
        });
        const base = window.location.origin + window.location.pathname;
        return `${base}?sign=${token}`;
    } catch (e) {
        console.warn("generateApprovalToken error:", e);
        return null;
    }
}

// --- 3. แสดง Dialog สำหรับคัดลอก Link ---
function showApprovalLinkDialog(url, recipientLabel) {
    const existing = document.getElementById('approval-link-dialog');
    if (existing) existing.remove();
    if (!url) return;

    const escaped = url.replace(/'/g, "\\'");
    const html = `
    <div id="approval-link-dialog"
         class="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[300]"
         onclick="if(event.target===this)this.remove()">
      <div class="bg-white rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl" onclick="event.stopPropagation()">
        <div class="text-center mb-5">
          <div class="text-4xl mb-2">🔗</div>
          <h3 class="font-bold text-xl text-gray-800">ลิงก์ขั้นตอนถัดไป</h3>
          <p class="text-sm text-gray-500 mt-1">
            ส่งให้ <span class="font-bold text-blue-700">${recipientLabel}</span>
            เพื่อลงนาม (หมดอายุใน 7 วัน)
          </p>
        </div>
        <div class="flex gap-2 mb-3">
          <input type="text" id="_ald_url" value="${url}" readonly
            class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50 focus:outline-none"
            onclick="this.select()">
          <button id="_ald_btn"
            onclick="(function(){
              var u = document.getElementById('_ald_url').value;
              var b = document.getElementById('_ald_btn');
              if(navigator.clipboard){
                navigator.clipboard.writeText(u).then(function(){
                  b.textContent='✅ คัดลอกแล้ว!';
                  b.className='bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap';
                });
              } else {
                document.getElementById('_ald_url').select();
                document.execCommand('copy');
                b.textContent='✅ คัดลอกแล้ว!';
                b.className='bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap';
              }
            })()"
            class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 whitespace-nowrap">
            📋 คัดลอก
          </button>
        </div>
        <p class="text-xs text-gray-400 text-center mb-4">
          ⚠️ ลิงก์ใช้ได้ครั้งเดียว ผู้รับไม่ต้องเข้าสู่ระบบ
        </p>
        <button onclick="document.getElementById('approval-link-dialog').remove()"
          class="w-full py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg">
          ปิด
        </button>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    setTimeout(() => { const i = document.getElementById('_ald_url'); if (i) i.select(); }, 100);
}

// --- 4. Mark token as used (เรียกหลังลงนามสำเร็จ) ---
async function markCurrentTokenUsed() {
    const token = window._currentSignToken;
    if (!token || typeof db === 'undefined') return;
    try {
        await db.collection('approvalLinks').doc(token).update({ used: true });
    } catch (e) {
        console.warn("markCurrentTokenUsed error:", e);
    }
    window._currentSignToken     = null;
    window._currentSignTokenData = null;
    window._currentSignReqData   = null;
}

// --- 5. แสดงผลสำเร็จบน Token Page พร้อมลิงก์ขั้นถัดไป ---
function showTokenSignSuccess(nextStatus, linkUrl) {
    const contentEl = document.getElementById('token-content');
    if (!contentEl) return;

    const nextLabel = (typeof getDocStatusLabel === 'function')
        ? getDocStatusLabel(nextStatus)
        : (nextStatus || '');

    let linkSection = '';
    if (linkUrl && nextStatus) {
        linkSection = `
        <div class="mt-4">
          <p class="text-sm text-gray-600 mb-2 font-semibold">🔗 ลิงก์สำหรับ ${nextLabel}:</p>
          <div class="flex gap-2">
            <input type="text" value="${linkUrl}" readonly id="_ts_link"
              class="flex-1 border rounded-lg px-3 py-2 text-sm bg-gray-50 focus:outline-none"
              onclick="this.select()">
            <button onclick="(function(){
                var u=document.getElementById('_ts_link').value;
                var b=this;
                if(navigator.clipboard){navigator.clipboard.writeText(u).then(function(){b.textContent='✅';b.className='bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold';});}
                else{document.getElementById('_ts_link').select();document.execCommand('copy');b.textContent='✅';b.className='bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold';}
              }).call(this)"
              class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700">
              📋
            </button>
          </div>
        </div>`;
    }

    contentEl.innerHTML = `
      <div class="text-center p-5 bg-green-50 rounded-xl border border-green-200 mb-2">
        <div class="text-4xl mb-2">✅</div>
        <p class="font-bold text-green-800 text-lg">ดำเนินการสำเร็จ</p>
        ${nextStatus
            ? `<p class="text-sm text-green-600 mt-1">เอกสารส่งต่อไปยัง: <strong>${nextLabel}</strong></p>`
            : '<p class="text-sm text-green-600 mt-1">ขั้นตอนสุดท้ายเสร็จสิ้น</p>'}
      </div>
      ${linkSection}`;
    contentEl.classList.remove('hidden');
}

// --- 6. ตรวจสอบ Token และแสดง UI สำหรับลงนาม ---
async function handleTokenSignFlow(token) {
    const overlay   = document.getElementById('token-sign-overlay');
    const loginEl   = document.getElementById('login-screen');
    const mainAppEl = document.getElementById('main-app');

    if (overlay)   overlay.classList.remove('hidden');
    if (loginEl)   loginEl.classList.add('hidden');
    if (mainAppEl) mainAppEl.classList.add('hidden');

    const loadingEl = document.getElementById('token-loading');
    const infoEl    = document.getElementById('token-info');
    const contentEl = document.getElementById('token-content');
    const errorEl   = document.getElementById('token-error');

    // รอ Firebase โหลด (max 5 วินาที)
    let retries = 0;
    while (typeof db === 'undefined' && retries < 50) {
        await new Promise(r => setTimeout(r, 100));
        retries++;
    }

    try {
        if (typeof db === 'undefined') throw new Error("ไม่สามารถเชื่อมต่อฐานข้อมูลได้");

        const tokenDoc = await db.collection('approvalLinks').doc(token).get();
        if (!tokenDoc.exists) throw new Error("ลิงก์ไม่ถูกต้อง หรือไม่พบในระบบ");

        const td = tokenDoc.data();
        if (td.used) throw new Error("ลิงก์นี้ถูกใช้งานไปแล้ว เอกสารได้รับการดำเนินการเรียบร้อยแล้ว");
        if (td.expiresAt && new Date() > td.expiresAt.toDate()) {
            throw new Error("ลิงก์หมดอายุแล้ว (เกิน 7 วัน) กรุณาขอลิงก์ใหม่จากผู้ส่ง");
        }

        // แจ้งเตือนถ้าลิงก์ใกล้หมดอายุ (น้อยกว่า 24 ชั่วโมง)
        if (td.expiresAt) {
            const msLeft = td.expiresAt.toDate() - new Date();
            if (msLeft > 0 && msLeft < 24 * 60 * 60 * 1000) {
                const hoursLeft = Math.max(1, Math.floor(msLeft / (60 * 60 * 1000)));
                const warningBanner = document.createElement('div');
                warningBanner.className = 'bg-amber-50 border border-amber-300 text-amber-800 text-sm rounded-xl px-4 py-3 mb-3 flex items-center gap-2';
                warningBanner.innerHTML = `<span class="text-lg">⏰</span><span>ลิงก์นี้จะหมดอายุใน <strong>${hoursLeft} ชั่วโมง</strong> กรุณาดำเนินการโดยเร็ว</span>`;
                const infoContainer = document.getElementById('token-info');
                if (infoContainer) infoContainer.insertAdjacentElement('afterbegin', warningBanner);
            }
        }

        const reqDoc = await db.collection('requests').doc(td.safeId).get();
        if (!reqDoc.exists) throw new Error("ไม่พบเอกสารในระบบ");

        const req    = reqDoc.data();
        // ★ ลำดับความสำคัญ:
        //   1. currentPdfUrl  = ไฟล์ล่าสุดที่มีลายเซ็นสะสม (จากการลงนามรอบก่อน)
        //   2. completedMemoUrl = ไฟล์ที่ผู้ใช้อัพโหลดเอง (บันทึกข้อความจริง)
        //   3. pdfUrl / memoPdfUrl = Cloud Run สร้าง (fallback เท่านั้น)
        const pdfUrl = req.currentPdfUrl || req.completedMemoUrl || req.pdfUrl || req.memoPdfUrl || '';
        if (!pdfUrl) throw new Error("ไม่พบไฟล์ PDF ของเอกสาร");

        // แสดงข้อมูลเอกสาร
        document.getElementById('token-doc-title').textContent     = req.purpose       || 'เอกสารไปราชการ';
        document.getElementById('token-doc-requester').textContent = req.requesterName || '-';
        document.getElementById('token-doc-date').textContent      = req.startDate     || req.date || '-';
        document.getElementById('token-doc-step').textContent      =
            (typeof getDocStatusLabel === 'function') ? getDocStatusLabel(td.docStatus) : td.docStatus;

        // เก็บไว้ใช้ภายหลัง
        window._currentSignToken     = token;
        window._currentSignTokenData = td;
        window._currentSignReqData   = req;

        if (loadingEl) loadingEl.classList.add('hidden');
        if (infoEl)    infoEl.classList.remove('hidden');
        if (!contentEl) return;
        contentEl.classList.remove('hidden');

        // --- สร้างปุ่มตาม docStatus ---
        if (td.docStatus === 'waiting_saraban') {
            // สารบรรณ: โหลด PDF bytes แล้วเปิด saraban modal
            // ⚠️ ห้าม fetch(Drive URL) โดยตรง → CORS blocked
            // ใช้ pdfBase64 จาก Firestore (เร็วสุด) หรือ GAS proxy แทน
            const _GAS_SARABAN = "https://script.google.com/macros/s/AKfycbyyUHx5gy7SFow_xex1Jt8TorLaWpxIgoYausg9z8QuSfoL8g_1r5on104A2m-PbGIWpA/exec";
            const _b64ToBuf = (b64) => {
                const bin = window.atob(b64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                return bytes.buffer;
            };
            let pdfBuffer = null;

            // 🚀 เส้นทาง 0: pdfBase64 จาก Firestore (ดึงมาพร้อม reqDoc แล้ว — ไม่ต้อง fetch เพิ่ม)
            if (req.pdfBase64) {
                try {
                    const buf = _b64ToBuf(req.pdfBase64);
                    if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) === '%PDF') {
                        pdfBuffer = buf;
                        console.log('🚀 saraban token: PDF loaded from Firestore cache — instant!');
                    }
                } catch (e) { console.warn('saraban pdfBase64 decode error:', e.message); }
            }
            // ⚠️ เส้นทาง 1: GAS proxy (Drive URL, ไม่มี Firestore cache)
            if (!pdfBuffer && pdfUrl.includes('drive.google.com')) {
                const driveId = (pdfUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || pdfUrl.match(/id=([a-zA-Z0-9_-]+)/))?.[1];
                if (driveId) {
                    const gasResp = await fetch(`${_GAS_SARABAN}?action=getPdfBase64&fileId=${driveId}`);
                    const gasData = await gasResp.json();
                    if (gasData.status === 'success') {
                        pdfBuffer = _b64ToBuf(gasData.data);
                    } else {
                        throw new Error('GAS proxy: ' + (gasData.message || 'โหลด PDF ไม่สำเร็จ'));
                    }
                }
            }
            // ⚠️ เส้นทาง 2: direct fetch (non-Drive URL เช่น Firebase Storage — ไม่มี CORS)
            if (!pdfBuffer && pdfUrl && !pdfUrl.includes('drive.google.com')) {
                const resp = await fetch(pdfUrl);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                pdfBuffer = await resp.arrayBuffer();
            }
            if (!pdfBuffer) throw new Error('ไม่สามารถโหลดไฟล์ PDF ได้');

            window._tokenPdfBytes = pdfBuffer;
            window._tokenPdfUrl   = pdfUrl;

            // ตรวจสอบประเภทเอกสาร: command หรือ memo
            const docType = req.docType || (req.commandPdfUrl ? 'command' : 'memo');

            if (docType === 'command') {
                contentEl.innerHTML = `
                  <button onclick="openSarabanModal(window._tokenPdfBytes, '${td.requestId}', 'command', '${pdfUrl}')"
                    class="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl flex justify-center items-center gap-2 text-lg shadow-md">
                    📝 เปิดระบบออกเลขที่และวันที่
                  </button>`;
            } else {
                contentEl.innerHTML = `
                  <div class="space-y-3">
                    <a href="${pdfUrl}" target="_blank"
                      class="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl flex justify-center items-center gap-2 font-medium">
                      📄 ดูเอกสาร PDF
                    </a>
                    <button onclick="openSarabanModal(window._tokenPdfBytes, '${td.requestId}', 'memo', '${pdfUrl}')"
                      class="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl flex justify-center items-center gap-2 text-lg shadow-md">
                      ✅ ตรวจสอบแล้ว ส่งผู้อำนวยการ
                    </button>
                  </div>`;
            }

        } else if (td.docStatus === 'waiting_admin_review') {
            // แอดมิน: ไม่ต้องเซ็น แค่กด forward
            contentEl.innerHTML = `
              <div class="space-y-3">
                <a href="${pdfUrl}" target="_blank"
                  class="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl flex justify-center items-center gap-2 font-medium">
                  📄 ดูเอกสาร PDF
                </a>
                <button onclick="tokenAdminForward()"
                  class="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl flex justify-center items-center gap-2 text-lg shadow-md">
                  ✅ ตรวจสอบแล้ว ส่งไปงานสารบรรณ
                </button>
              </div>`;

        } else {
            // ทุก role ที่ต้องเซ็น (หัวหน้า, รองบุคคล, รองวิชาการ, ผอ.)
            window._tokenPdfUrl = pdfUrl;
            contentEl.innerHTML = `
              <div class="space-y-3">
                <a href="${pdfUrl}" target="_blank"
                  class="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl flex justify-center items-center gap-2 font-medium">
                  📄 ดูเอกสาร PDF
                </a>
                <button onclick="openTokenSignatureSystem()"
                  class="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl flex justify-center items-center gap-2 text-lg shadow-md">
                  ✍️ เปิดเอกสารและลงนาม
                </button>
              </div>`;
        }

    } catch (e) {
        console.error("Token sign error:", e);
        if (loadingEl) loadingEl.classList.add('hidden');
        if (errorEl) {
            errorEl.textContent = '❌ ' + e.message;
            errorEl.classList.remove('hidden');
        }
    }
}

// --- 7. เปิด Signature System จาก Token Page ---
function openTokenSignatureSystem() {
    const td = window._currentSignTokenData;
    if (!td || !window._tokenPdfUrl) return;
    openSignatureSystem(window._tokenPdfUrl, td.requestId, '✍️ ลงนามเอกสาร', td.docStatus);
}

// --- 8. Admin forward จาก Token Page (ไม่ต้องเซ็น) ---
async function tokenAdminForward() {
    const td  = window._currentSignTokenData;
    const req = window._currentSignReqData || {};
    if (!td) return;
    try {
        showAlert('กำลังดำเนินการ', 'กำลังส่งเอกสารไปงานสารบรรณ...', false);
        if (typeof db !== 'undefined') {
            await db.collection('requests').doc(td.safeId).set({
                docStatus:       'waiting_saraban',
                adminReviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        apiCall('POST', 'updateRequest', { requestId: td.requestId, docStatus: 'waiting_saraban' })
            .catch(e => console.warn(e));
        await markCurrentTokenUsed();

        document.getElementById('alert-modal').style.display = 'none';
        showTokenSignSuccess('waiting_saraban', null);
    } catch (e) {
        document.getElementById('alert-modal').style.display = 'none';
        alert("เกิดข้อผิดพลาด: " + e.message);
    }
}

// ==============================================================
// ระบบจัดการลิงก์ลงนาม (สำหรับแอดมินเท่านั้น)
// ==============================================================

// Cache เอกสารสำหรับหน้าจัดการลิงก์
window._adminApprovalDocs = {};

// --- 9. Admin: โหลดและแสดงหน้าจัดการลิงก์ลงนาม ---
async function loadApprovalLinkManagement() {
    if (typeof switchPage === 'function') switchPage('admin-approval-links-page');

    const container = document.getElementById('approval-links-container');
    if (!container) return;
    container.innerHTML = '<div class="flex justify-center py-10"><div class="loader"></div></div>';

    if (typeof db === 'undefined') {
        container.innerHTML = '<p class="text-center text-red-500 py-8">ไม่สามารถเชื่อมต่อฐานข้อมูลได้</p>';
        return;
    }

    // ★★★ รอให้ Firebase Auth พร้อมใช้งาน (แก้ปัญหา Missing or insufficient permissions) ★★★
    if (typeof firebase !== 'undefined' && !firebase.auth().currentUser) {
        console.warn('⏳ loadApprovalLinkManagement: Waiting for Firebase Auth...');
        await new Promise(resolve => {
            const unsubscribe = firebase.auth().onAuthStateChanged(user => {
                unsubscribe();
                resolve(user);
            });
        });

        if (!firebase.auth().currentUser) {
            console.error('❌ loadApprovalLinkManagement: Not logged in (Firebase)');
            container.innerHTML = '<p class="text-center text-red-500 py-8">⚠️ กรุณาเข้าสู่ระบบใหม่เพื่อใช้งานฟีเจอร์นี้</p>';
            return;
        }
    }

    // Firestore "in" query รองรับสูงสุด 10 ค่า — แบ่ง 3 batch
    const batch1 = [
        'waiting_head_thai',     'waiting_head_foreign',  'waiting_head_science',
        'waiting_head_art',      'waiting_head_social',   'waiting_head_health',
        'waiting_head_career',   'waiting_head_math',
        'waiting_head_guidance', 'waiting_head_general',
    ];
    const batch2 = [
        'waiting_head_personnel','waiting_head_budget',   'waiting_head_acad',
        'waiting_dep_personnel', 'waiting_dep_acad',
        'waiting_dep_general',   'waiting_dep_budget',
    ];
    const batch3 = ['waiting_admin_review', 'waiting_saraban', 'waiting_director'];

    try {
        const [snap1, snap2, snap3] = await Promise.all([
            db.collection('requests').where('docStatus', 'in', batch1).get(),
            db.collection('requests').where('docStatus', 'in', batch2).get(),
            db.collection('requests').where('docStatus', 'in', batch3).get(),
        ]);

        // รวมผลลัพธ์ + เก็บ cache
        window._adminApprovalDocs = {};
        const allDocs = [];
        [snap1, snap2, snap3].forEach(snap => {
            snap.docs.forEach(doc => {
                const data = doc.data();
                window._adminApprovalDocs[doc.id] = data;
                allDocs.push({ id: doc.id, ...data });
            });
        });

        if (allDocs.length === 0) {
            container.innerHTML = `
              <div class="text-center py-12 text-gray-400">
                <div class="text-5xl mb-3">📭</div>
                <p class="text-lg font-medium">ไม่มีเอกสารรอดำเนินการ</p>
                <p class="text-sm mt-1">เอกสารทั้งหมดได้รับการดำเนินการเรียบร้อยแล้ว</p>
              </div>`;
            return;
        }

        // จัดกลุ่มตาม docStatus
        const grouped = {};
        allDocs.forEach(doc => {
            const s = doc.docStatus || 'unknown';
            if (!grouped[s]) grouped[s] = [];
            grouped[s].push(doc);
        });

        // ลำดับ status ทั้งหมด
        const statusOrder = [
            'waiting_head_thai',      'waiting_head_foreign',   'waiting_head_science',
            'waiting_head_art',       'waiting_head_social',    'waiting_head_health',
            'waiting_head_career',    'waiting_head_math',
            'waiting_head_guidance',  'waiting_head_general',
            'waiting_head_personnel', 'waiting_head_budget',    'waiting_head_acad',
            'waiting_dep_personnel',  'waiting_dep_acad',
            'waiting_dep_general',    'waiting_dep_budget',
            'waiting_admin_review',   'waiting_saraban',        'waiting_director',
        ];

        const O = 'border-orange-300 bg-orange-50';
        const Ob = 'bg-orange-100 text-orange-700';
        const B = 'border-blue-300 bg-blue-50';
        const Bb = 'bg-blue-100 text-blue-700';
        const groupMeta = {
            'waiting_head_thai':      { label: 'หัวหน้ากลุ่มสาระภาษาไทย',           color: O, badge: Ob },
            'waiting_head_foreign':   { label: 'หัวหน้ากลุ่มสาระภาษาต่างประเทศ',    color: O, badge: Ob },
            'waiting_head_science':   { label: 'หัวหน้ากลุ่มสาระวิทยาศาสตร์ฯ',      color: O, badge: Ob },
            'waiting_head_art':       { label: 'หัวหน้ากลุ่มสาระศิลปะ',             color: O, badge: Ob },
            'waiting_head_social':    { label: 'หัวหน้ากลุ่มสาระสังคมศึกษาฯ',       color: O, badge: Ob },
            'waiting_head_health':    { label: 'หัวหน้ากลุ่มสาระสุขศึกษาฯ',         color: O, badge: Ob },
            'waiting_head_career':    { label: 'หัวหน้ากลุ่มสาระการงานอาชีพ',       color: O, badge: Ob },
            'waiting_head_math':      { label: 'หัวหน้ากลุ่มสาระคณิตศาสตร์',        color: O, badge: Ob },
            'waiting_head_guidance':  { label: 'หัวหน้างานแนะแนว',                  color: O, badge: Ob },
            'waiting_head_general':   { label: 'หัวหน้ากลุ่มบริหารทั่วไป',           color: O, badge: Ob },
            'waiting_head_personnel': { label: 'หัวหน้ากลุ่มบริหารงานบุคคล',         color: O, badge: Ob },
            'waiting_head_budget':    { label: 'หัวหน้ากลุ่มบริหารงบประมาณ',         color: O, badge: Ob },
            'waiting_head_acad':      { label: 'หัวหน้ากลุ่มบริหารวิชาการ',          color: O, badge: Ob },
            'waiting_dep_personnel':  { label: 'รองผู้อำนวยการ กลุ่มบริหารงานบุคคล', color: B, badge: Bb },
            'waiting_dep_acad':       { label: 'รองผู้อำนวยการ กลุ่มบริหารวิชาการ',  color: B, badge: Bb },
            'waiting_dep_general':    { label: 'รองผู้อำนวยการ กลุ่มบริหารทั่วไป',   color: B, badge: Bb },
            'waiting_dep_budget':     { label: 'รองผู้อำนวยการ กลุ่มบริหารงบประมาณ', color: B, badge: Bb },
            'waiting_admin_review':   { label: 'แอดมิน (ตรวจสอบก่อนส่งสารบรรณ)',    color: 'border-yellow-300 bg-yellow-50', badge: 'bg-yellow-100 text-yellow-700' },
            'waiting_saraban':        { label: 'งานสารบรรณ',                         color: 'border-indigo-300 bg-indigo-50', badge: 'bg-indigo-100 text-indigo-700' },
            'waiting_director':       { label: 'ผู้อำนวยการ (ลงนาม)',                color: 'border-red-300 bg-red-50',       badge: 'bg-red-100 text-red-700'       },
        };

        let html = '';
        statusOrder.forEach(status => {
            const items = grouped[status];
            if (!items || items.length === 0) return;
            const meta = groupMeta[status] || { label: status, color: 'border-gray-300 bg-gray-50', badge: 'bg-gray-100 text-gray-700' };

            html += `
            <div class="border-2 ${meta.color} rounded-xl p-4">
              <div class="flex items-center justify-between mb-3">
                <h3 class="font-bold text-gray-700 flex items-center gap-2 text-sm sm:text-base">
                  🔐 รอลงนาม: <span class="text-blue-700">${meta.label}</span>
                </h3>
                <span class="text-xs px-2.5 py-0.5 rounded-full font-semibold ${meta.badge} whitespace-nowrap">${items.length} รายการ</span>
              </div>
              <div class="space-y-2">`;

            items.forEach(doc => {
                const purpose   = (doc.purpose   || 'เอกสารไปราชการ').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                const requester = (doc.requesterName || '-').replace(/&/g,'&amp;').replace(/</g,'&lt;');
                const date      = doc.startDate || doc.date || '-';
                const docId     = doc.id; // safeId — ไม่มี special chars

                html += `
                <div class="bg-white rounded-lg border border-gray-200 p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <div class="flex-1 min-w-0">
                    <p class="font-medium text-gray-800 text-sm truncate">${purpose}</p>
                    <p class="text-xs text-gray-500 mt-0.5">ผู้ขอ: ${requester} &nbsp;|&nbsp; วันที่: ${date}</p>
                  </div>
                  <div class="flex flex-col sm:flex-row gap-1.5 flex-shrink-0">
                    <button id="alm-btn-${docId}"
                      onclick="adminGenerateLink(this, '${docId}', '${status}')"
                      class="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors">
                      🔗 สร้างลิงก์ส่งให้
                    </button>
                    ${status !== 'waiting_admin_review' ? `<button
                      onclick="adminSkipStep('${docId}', '${status}')"
                      class="w-full sm:w-auto px-3 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-bold rounded-lg flex items-center justify-center gap-1 transition-colors whitespace-nowrap">
                      ⏭️ ข้ามขั้นตอนนี้
                    </button>` : ''}
                    <button
                      onclick="adminCancelForward(this, '${docId}', '${status}')"
                      class="w-full sm:w-auto px-3 py-2 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white text-sm font-bold rounded-lg flex items-center justify-center gap-1 transition-colors whitespace-nowrap">
                      ↩️ ยกเลิกการส่งต่อ
                    </button>
                    <button
                      onclick="adminHandleOffline(this, '${docId}', '${status}')"
                      class="w-full sm:w-auto px-3 py-2 bg-gray-500 hover:bg-gray-600 active:bg-gray-700 text-white text-sm font-bold rounded-lg flex items-center justify-center gap-1 transition-colors whitespace-nowrap">
                      📴 จัดการแบบออฟไลน์
                    </button>
                  </div>
                </div>`;
            });

            html += `</div></div>`;
        });

        container.innerHTML = html;

    } catch (e) {
        console.error("loadApprovalLinkManagement error:", e);
        const errP = document.createElement('p');
        errP.className = 'text-center text-red-500 py-8';
        errP.textContent = '⚠️ เกิดข้อผิดพลาด: ' + e.message;
        container.innerHTML = '';
        container.appendChild(errP);
    }
}

// --- 10. Admin: จัดการเอกสารแบบออฟไลน์ (ดึงออกจากระบบลิงก์ลงนามทั้งหมด) ---
async function adminHandleOffline(btn, docId, currentStatus) {
    const label   = (typeof getDocStatusLabel === 'function')
        ? getDocStatusLabel(currentStatus) : currentStatus;
    const docMeta = window._adminApprovalDocs?.[docId] || {};
    const purpose = docMeta.purpose || docId;

    if (!confirm(
        `📴 ยืนยันจัดการเอกสารแบบออฟไลน์:\n\n` +
        `เอกสาร: ${purpose}\n` +
        `สถานะปัจจุบัน: ${label}\n\n` +
        `เอกสารจะถูกนำออกจากระบบลิงก์ลงนามทั้งหมด\n` +
        `และจะไม่แสดงในหน้าจัดการลิงก์ลงนามอีกต่อไป\n` +
        `ลิงก์ที่เคยสร้างไว้จะถูกยกเลิกทั้งหมด`
    )) return;

    const origHTML  = btn.innerHTML;
    const origClass = btn.className;
    btn.disabled    = true;
    btn.innerHTML   = '⏳ กำลังดำเนินการ...';

    const user      = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
    const safeId    = docId.replace(/[\/\\:\.]/g, '-');
    const roleKey   = currentStatus.replace(/^waiting_/, '');
    const origDocId = docMeta.id || docMeta.requestId || docId;

    try {
        if (typeof showAlert === 'function')
            showAlert('กำลังดำเนินการ', 'กำลังนำเอกสารออกจากระบบลิงก์ลงนาม...', false);

        // 1. อัปเดต Firestore: เปลี่ยน docStatus เป็น handled_offline
        const updateData = {
            docStatus:                          'handled_offline',
            offlineFrom:                        currentStatus,
            offlineBy:                          user?.name || user?.fullName || user?.username || 'admin',
            offlineAt:                          firebase.firestore.FieldValue.serverTimestamp(),
            lastUpdated:                        firebase.firestore.FieldValue.serverTimestamp(),
        };

        if (typeof db !== 'undefined') {
            await db.collection('requests').doc(safeId).set(updateData, { merge: true });
        }

        // 2. ยกเลิก approvalLinks ที่ยังไม่ได้ใช้ (mark used=true)
        if (typeof db !== 'undefined') {
            try {
                const linksSnap = await db.collection('approvalLinks')
                    .where('safeId', '==', safeId)
                    .where('used', '==', false)
                    .get();
                const batch = db.batch();
                linksSnap.docs.forEach(linkDoc => {
                    batch.update(linkDoc.ref, { used: true });
                });
                if (!linksSnap.empty) {
                    await batch.commit();
                    console.log(`🔗 ยกเลิก approvalLinks ${linksSnap.size} รายการ (ออฟไลน์) สำหรับ ${safeId}`);
                }
            } catch (linkErr) {
                console.warn('⚠️ ยกเลิก approvalLinks ไม่สำเร็จ (ออฟไลน์):', linkErr.message);
            }
        }

        // 3. Sync กลับไปยัง Google Sheets (background)
        if (typeof apiCall === 'function') {
            apiCall('POST', 'updateRequest', {
                requestId: origDocId,
                docStatus: 'handled_offline',
            }).catch(err => console.warn('Sheet update error (offline):', err));
        }

        // 4. ปิด loading alert
        const alertEl = document.getElementById('alert-modal');
        if (alertEl) alertEl.style.display = 'none';

        // 5. แจ้งผลสำเร็จ
        if (typeof showAlert === 'function') {
            showAlert('✅ ดำเนินการสำเร็จ',
                `นำเอกสาร "${purpose}" ออกจากระบบลิงก์ลงนามแล้ว\n\n` +
                `สถานะเปลี่ยนเป็น "จัดการแบบออฟไลน์"\n` +
                `ลิงก์ลงนามทั้งหมดถูกยกเลิกแล้ว`);
        }

        // 6. รีโหลดรายการ
        setTimeout(() => loadApprovalLinkManagement(), 500);

    } catch (e) {
        const alertEl = document.getElementById('alert-modal');
        if (alertEl) alertEl.style.display = 'none';

        btn.disabled  = false;
        btn.innerHTML = origHTML;
        btn.className = origClass;

        if (typeof showAlert === 'function') showAlert('❌ ผิดพลาด', 'ไม่สามารถดำเนินการได้: ' + e.message);
        else alert('เกิดข้อผิดพลาด: ' + e.message);
    }
}

// --- 10.1 Admin: ยกเลิกการส่งต่อเอกสาร (ดึงกลับมาที่แอดมิน) ---
async function adminCancelForward(btn, docId, currentStatus) {
    const label   = (typeof getDocStatusLabel === 'function')
        ? getDocStatusLabel(currentStatus) : currentStatus;
    const docMeta = window._adminApprovalDocs?.[docId] || {};
    const purpose = docMeta.purpose || docId;

    if (!confirm(
        `⚠️ ยืนยันยกเลิกการส่งต่อเอกสาร:\n\n` +
        `เอกสาร: ${purpose}\n` +
        `สถานะปัจจุบัน: ${label}\n\n` +
        `เอกสารจะถูกดึงกลับมาที่สถานะ "รอแอดมินตรวจสอบ"\n` +
        `ลิงก์ลงนามที่เคยสร้างไว้จะถูกยกเลิกทั้งหมด`
    )) return;

    const origHTML  = btn.innerHTML;
    const origClass = btn.className;
    btn.disabled    = true;
    btn.innerHTML   = '⏳ กำลังยกเลิก...';

    const user      = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
    const safeId    = docId.replace(/[\/\\:\.]/g, '-');
    const roleKey   = currentStatus.replace(/^waiting_/, '');
    const origDocId = docMeta.id || docMeta.requestId || docId;

    try {
        if (typeof showAlert === 'function')
            showAlert('กำลังดำเนินการ', 'กำลังยกเลิกการส่งต่อเอกสาร...', false);

        // 1. อัปเดต Firestore: ดึงกลับมาที่ waiting_admin_review
        const updateData = {
            docStatus:                          'waiting_admin_review',
            [`cancelledStep_${roleKey}`]:       true,
            [`cancelledBy_${roleKey}`]:         user?.name || user?.fullName || user?.username || 'admin',
            [`cancelledAt_${roleKey}`]:         firebase.firestore.FieldValue.serverTimestamp(),
            lastUpdated:                        firebase.firestore.FieldValue.serverTimestamp(),
        };

        if (typeof db !== 'undefined') {
            await db.collection('requests').doc(safeId).set(updateData, { merge: true });
        }

        // 2. ยกเลิก approvalLinks ที่ยังไม่ได้ใช้ (mark used=true)
        if (typeof db !== 'undefined') {
            try {
                const linksSnap = await db.collection('approvalLinks')
                    .where('safeId', '==', safeId)
                    .where('used', '==', false)
                    .get();
                const batch = db.batch();
                linksSnap.docs.forEach(linkDoc => {
                    batch.update(linkDoc.ref, { used: true });
                });
                if (!linksSnap.empty) {
                    await batch.commit();
                    console.log(`🔗 ยกเลิก approvalLinks ${linksSnap.size} รายการ สำหรับ ${safeId}`);
                }
            } catch (linkErr) {
                console.warn('⚠️ ยกเลิก approvalLinks ไม่สำเร็จ:', linkErr.message);
            }
        }

        // 3. Sync กลับไปยัง Google Sheets (background)
        if (typeof apiCall === 'function') {
            apiCall('POST', 'updateRequest', {
                requestId: origDocId,
                docStatus: 'waiting_admin_review',
            }).catch(err => console.warn('Sheet update error (cancel):', err));
        }

        // 4. Sync cache
        window._approvalDocs = window._approvalDocs || {};
        window._approvalDocs[safeId] = {
            ...docMeta,
            docStatus: 'waiting_admin_review',
            [`cancelledStep_${roleKey}`]: true,
            [`cancelledBy_${roleKey}`]:   user?.name || user?.fullName || user?.username || 'admin',
        };

        // 5. ปิด loading alert
        const alertEl = document.getElementById('alert-modal');
        if (alertEl) alertEl.style.display = 'none';

        // 6. แจ้งผลสำเร็จ
        if (typeof showAlert === 'function') {
            showAlert('✅ ยกเลิกสำเร็จ',
                `ยกเลิกการส่งต่อเอกสาร "${purpose}"\n` +
                `จากขั้นตอน "${label}" เรียบร้อยแล้ว\n\n` +
                `เอกสารกลับมาอยู่ที่ "รอแอดมินตรวจสอบ"`);
        }

        // 7. รีโหลดรายการ
        setTimeout(() => loadApprovalLinkManagement(), 500);

    } catch (e) {
        const alertEl = document.getElementById('alert-modal');
        if (alertEl) alertEl.style.display = 'none';

        btn.disabled  = false;
        btn.innerHTML = origHTML;
        btn.className = origClass;

        if (typeof showAlert === 'function') showAlert('❌ ผิดพลาด', 'ไม่สามารถยกเลิกได้: ' + e.message);
        else alert('เกิดข้อผิดพลาด: ' + e.message);
    }
}

// --- 11. Admin: สร้างลิงก์ส่งให้ผู้อนุมัติรายเอกสาร ---
async function adminGenerateLink(btn, requestId, docStatus) {
    if (!requestId || !docStatus) return;

    const origHTML  = btn.innerHTML;
    const origClass = btn.className;
    btn.disabled    = true;
    btn.innerHTML   = '⏳ กำลังสร้าง...';

    try {
        const docMeta = window._adminApprovalDocs[requestId] || {};
        const url     = await generateApprovalToken(requestId, docStatus, docMeta);
        if (!url) throw new Error('ไม่สามารถสร้างลิงก์ได้ กรุณาตรวจสอบการเชื่อมต่อ');

        const label = (typeof getDocStatusLabel === 'function')
            ? getDocStatusLabel(docStatus) : docStatus;
        showApprovalLinkDialog(url, label);

        btn.innerHTML = '✅ สร้างลิงก์แล้ว';
        btn.className = 'flex-shrink-0 w-full sm:w-auto px-4 py-2 bg-green-600 text-white text-sm font-bold rounded-lg flex items-center justify-center gap-1.5';

        setTimeout(() => {
            btn.disabled  = false;
            btn.innerHTML = origHTML;
            btn.className = origClass;
        }, 4000);

    } catch (e) {
        console.error("adminGenerateLink error:", e);
        alert("เกิดข้อผิดพลาดในการสร้างลิงก์: " + e.message);
        btn.disabled  = false;
        btn.innerHTML = origHTML;
        btn.className = origClass;
    }
}

// --- 11. Admin: ข้ามขั้นตอนการลงนาม ---
async function adminSkipStep(docId, currentStatus) {
    const label   = (typeof getDocStatusLabel === 'function')
        ? getDocStatusLabel(currentStatus) : currentStatus;
    const docMeta = window._adminApprovalDocs?.[docId] || {};
    const purpose = docMeta.purpose || docId;

    if (!confirm(
        `ยืนยันข้ามขั้นตอน:\n"${label}"\n\nเอกสาร: ${purpose}\n\n` +
        `เอกสารจะกลับมาหาแอดมินก่อน แล้วแอดมินเลือกส่งต่อได้เลย`
    )) return;

    const user      = getCurrentUser();
    const safeId    = docId.replace(/[\/\\:\.]/g, '-');
    // roleKey = waiting_head_thai → head_thai  (ตัดคำนำหน้า waiting_)
    const roleKey   = currentStatus.replace(/^waiting_/, '');
    // original ID (อาจมี / หรือ . ซึ่ง GAS ต้องการ) ดึงจาก cache
    const origDocId = docMeta.id || docMeta.requestId || docId;

    try {
        if (typeof showAlert === 'function')
            showAlert('กำลังดำเนินการ', 'กำลังข้ามขั้นตอน...', false);

        const updateData = {
            docStatus:                      'waiting_admin_review',
            [`skippedStep_${roleKey}`]:     true,
            [`skippedBy_${roleKey}`]:       user?.name || user?.username || 'admin',
            [`skippedAt_${roleKey}`]:       firebase.firestore.FieldValue.serverTimestamp(),
            lastUpdated:                    firebase.firestore.FieldValue.serverTimestamp(),
        };

        if (typeof db !== 'undefined') {
            await db.collection('requests').doc(safeId).set(updateData, { merge: true });
        }

        apiCall('POST', 'updateRequest', {
            requestId: origDocId,
            docStatus: 'waiting_admin_review',
        }).catch(err => console.warn('Sheet update error (skip):', err));

        // sync ข้อมูลเข้า _approvalDocs เพื่อให้ adminRouteDocument อ่านได้
        window._approvalDocs = window._approvalDocs || {};
        window._approvalDocs[safeId] = {
            ...docMeta,
            docStatus: 'waiting_admin_review',
            [`skippedStep_${roleKey}`]: true,
            [`skippedBy_${roleKey}`]:   user?.name || user?.username || 'admin',
        };

        // ปิด loading alert
        const alertEl = document.getElementById('alert-modal');
        if (alertEl) alertEl.style.display = 'none';

        // รีโหลดรายการในหน้าจัดการลิงก์ (background)
        setTimeout(() => loadApprovalLinkManagement(), 300);

        // เปิด route modal ให้แอดมินเลือกส่งต่อทันที
        if (typeof adminRouteDocument === 'function') {
            adminRouteDocument(safeId);
        } else {
            if (typeof showAlert === 'function')
                showAlert('✅ ข้ามสำเร็จ',
                    `ข้ามขั้นตอน "${label}" แล้ว\nกรุณาไปที่หน้ารออนุมัติเพื่อส่งต่อ`);
        }

    } catch (e) {
        const alertEl = document.getElementById('alert-modal');
        if (alertEl) alertEl.style.display = 'none';
        if (typeof showAlert === 'function') showAlert('❌ ผิดพลาด', e.message);
        else alert('เกิดข้อผิดพลาด: ' + e.message);
    }
}
