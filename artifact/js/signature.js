// ============================================================
// ระบบลงลายเซ็น — Drag-Drop Version
// วาดลายเซ็น → ลากวางบน PDF → คัดลอกหลายจุด → ยืนยันส่งต่อ
// รองรับทั้ง Dashboard (login) และ Token Link (ไม่ login)
// ============================================================

let sigState = {
    pdfBytes:        null,
    docId:           null,
    scale:           1.5,
    padInstance:     null,
    currentDocStatus: null,
    placements:      [],       // [{ el: HTMLElement, sigDataURL: string }]
    lastSigDataURL:  null,     // data URL ลายเซ็นล่าสุดที่วาด
};

// ============================================================
// Helper: ลำดับขั้นตอน docStatus
// ============================================================
function getNextDocStatus(currentStatus) {
    // ★★★ ระบบใหม่: ทุกขั้นตอนวนกลับมาหา Admin ก่อน
    //       Admin จะเป็นคนเลือกเองว่าจะส่งต่อไปตำแหน่งใด (ข้ามขั้นตอนได้)
    //       ยกเว้น ผอ. ลงนาม → อนุมัติสุดท้าย (ไม่ต้องผ่าน admin อีก) ★★★
    if (currentStatus === 'waiting_director') return 'อนุมัติ';
    if (currentStatus && currentStatus.startsWith('waiting_')) return 'waiting_admin_review';
    return null;
}

function getDocStatusLabel(status) {
    const labels = {
        'waiting_head_thai':      'หัวหน้ากลุ่มสาระภาษาไทย',
        'waiting_head_foreign':   'หัวหน้ากลุ่มสาระภาษาต่างประเทศ',
        'waiting_head_science':   'หัวหน้ากลุ่มสาระวิทยาศาสตร์ฯ',
        'waiting_head_art':       'หัวหน้ากลุ่มสาระศิลปะ',
        'waiting_head_social':    'หัวหน้ากลุ่มสาระสังคมศึกษาฯ',
        'waiting_head_health':    'หัวหน้ากลุ่มสาระสุขศึกษาฯ',
        'waiting_head_career':    'หัวหน้ากลุ่มสาระการงานอาชีพ',
        'waiting_head_math':      'หัวหน้ากลุ่มสาระคณิตศาสตร์',
        'waiting_head_guidance':  'หัวหน้างานแนะแนว',
        'waiting_head_general':   'หัวหน้ากลุ่มบริหารทั่วไป',
        'waiting_head_personnel': 'หัวหน้ากลุ่มบริหารงานบุคคล',
        'waiting_head_budget':    'หัวหน้ากลุ่มบริหารงบประมาณ',
        'waiting_head_acad':      'หัวหน้ากลุ่มบริหารวิชาการ',
        'waiting_dep_personnel':  'รองผู้อำนวยการกลุ่มบริหารงานบุคคล',
        'waiting_dep_acad':       'รองผู้อำนวยการกลุ่มบริหารวิชาการ',
        'waiting_dep_general':    'รองผู้อำนวยการกลุ่มบริหารทั่วไป',
        'waiting_dep_budget':     'รองผู้อำนวยการกลุ่มบริหารงบประมาณ',
        'waiting_admin_review':   'แอดมิน (รอตรวจสอบก่อนส่งสารบรรณ)',
        'waiting_saraban':        'งานสารบรรณ',
        'waiting_director':       'ผู้อำนวยการ',
        'อนุมัติ':                'อนุมัติแล้ว ✅',
        'เสร็จสิ้น':              'เสร็จสิ้น (อนุมัติแล้ว)',
    };
    return labels[status] || status || 'ขั้นตอนถัดไป';
}

// ============================================================
// 1. เปิด Modal และโหลด PDF
// ============================================================
async function openSignatureSystem(pdfUrl, documentId, title = '✍️ ลงนามเอกสาร', currentDocStatus = null) {
    try {
        sigState.docId           = documentId;
        sigState.currentDocStatus = currentDocStatus;
        sigState.placements      = [];
        sigState.lastSigDataURL  = null;

        // ตั้งชื่อ modal
        document.getElementById('signature-modal-title').innerText = title;

        // ซ่อนปุ่มคัดลอก
        document.getElementById('btn-dup-sig').classList.add('hidden');

        // ล้าง overlays เก่า
        const container = document.getElementById('signature-pdf-container');
        container.querySelectorAll('.sig-placement').forEach(el => el.remove());

        // แสดง Modal
        document.getElementById('signature-modal').classList.remove('hidden');

        // ── โหลด PDF bytes ──
        // เส้นทาง 0 → 1 → 2 (เร็วสุด → ช้าสุด)
        const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyyUHx5gy7SFow_xex1Jt8TorLaWpxIgoYausg9z8QuSfoL8g_1r5on104A2m-PbGIWpA/exec";

        // Helper: ตรวจ magic bytes %PDF
        const isPdfBuffer = (buf) =>
            buf instanceof ArrayBuffer && buf.byteLength > 4 &&
            String.fromCharCode(...new Uint8Array(buf, 0, 4)) === '%PDF';

        // Helper: decode raw base64 → ArrayBuffer
        const decodeBase64ToBuf = (b64) => {
            const bin   = window.atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return bytes.buffer;
        };

        let pdfBytes = null;

        // 🚀 เส้นทาง 0: Firestore pdfBase64 (เร็วที่สุด — ไม่ต้อง network request ไป Drive)
        // ตรวจจาก window._approvalDocs cache ก่อน (dashboard flow)
        const _safeDocId  = documentId ? documentId.replace(/[\/\\:\.]/g, '-') : '';
        const _cachedDoc  = (documentId && window._approvalDocs?.[_safeDocId])
                         || (documentId && window._approvalDocs?.[documentId]);
        if (_cachedDoc?.pdfBase64) {
            try {
                const buf = decodeBase64ToBuf(_cachedDoc.pdfBase64);
                if (isPdfBuffer(buf)) {
                    pdfBytes = buf;
                    console.log('🚀 PDF loaded from Firestore cache (window._approvalDocs) — instant!');
                }
            } catch (e) { console.warn('Firestore cache decode error:', e.message); }
        }
        // ถ้ายังไม่ได้ → ลอง query Firestore โดยตรง (token flow หรือ reload page)
        if (!pdfBytes && typeof db !== 'undefined' && documentId) {
            try {
                const safeId = _safeDocId;
                const snap   = await db.collection('requests').doc(safeId).get();
                const fbBase64 = snap.exists ? snap.data()?.pdfBase64 : null;
                if (fbBase64) {
                    const buf = decodeBase64ToBuf(fbBase64);
                    if (isPdfBuffer(buf)) {
                        pdfBytes = buf;
                        console.log('🚀 PDF loaded from Firestore (direct query) — fast!');
                    }
                }
            } catch (e) { console.warn('Firestore direct query error:', e.message); }
        }

        // ⚠️ เส้นทาง 1: GAS base64 proxy (ถ้า Drive URL และไม่มี Firestore cache)
        if (!pdfBytes && pdfUrl && pdfUrl.includes('drive.google.com')) {
            const driveId = (pdfUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || pdfUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/))?.[1];
            if (driveId) {
                try {
                    const resp   = await fetch(`${SCRIPT_URL}?action=getPdfBase64&fileId=${driveId}`);
                    const result = await resp.json();
                    if (result.status === 'success') {
                        const buf = decodeBase64ToBuf(result.data);
                        if (isPdfBuffer(buf)) pdfBytes = buf;
                        else console.warn('GAS base64 ไม่ใช่ PDF จริง');
                    }
                } catch (e) { console.warn('GAS base64 fallback error:', e.message); }
            }
        }

        // ⚠️ เส้นทาง 2: fetch ตรง (Non-Drive URL เช่น Firebase Storage)
        if (!pdfBytes && pdfUrl && !pdfUrl.includes('drive.google.com')) {
            try {
                const resp = await fetch(pdfUrl);
                if (resp.ok) {
                    const buf = await resp.arrayBuffer();
                    if (isPdfBuffer(buf)) pdfBytes = buf;
                    else console.warn('Direct fetch ไม่ใช่ PDF magic:', String.fromCharCode(...new Uint8Array(buf, 0, 4)));
                }
            } catch (e) { console.warn('Direct fetch error:', e.message); }
        }

        if (!pdfBytes) throw new Error('ไม่สามารถโหลดไฟล์ PDF ได้ (ลองทุกวิธีแล้วไม่พบข้อมูล PDF ที่ถูกต้อง)');
        sigState.pdfBytes = pdfBytes;

        // Render PDF หน้า 1 ลงบน canvas
        const canvas = document.getElementById('signature-pdf-canvas');
        const ctx    = canvas.getContext('2d');
        const task   = pdfjsLib.getDocument({ data: new Uint8Array(sigState.pdfBytes) });
        const pdfDoc = await task.promise;
        const page   = await pdfDoc.getPage(1);
        const vp     = page.getViewport({ scale: sigState.scale });
        canvas.width  = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: ctx, viewport: vp }).promise;

        // เริ่มต้น SignaturePad (ต้อง delay เล็กน้อยเพื่อให้ canvas render เสร็จก่อน)
        setTimeout(_initSignaturePad, 100);

    } catch (err) {
        console.error('openSignatureSystem error:', err);
        alert('ไม่สามารถเปิดไฟล์ PDF ได้: ' + err.message);
    }
}

function closeSignatureModal() {
    document.getElementById('signature-modal').classList.add('hidden');
    // เคลียร์ placements
    sigState.placements.forEach(p => { try { p.el.remove(); } catch(e) {} });
    sigState.placements = [];
}

// ============================================================
// 2. Signature Pad — เริ่มต้นและวาด
// ============================================================
function _initSignaturePad() {
    const canvas = document.getElementById('signature-pad-canvas');
    if (!canvas) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width  = canvas.offsetWidth  * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d').scale(ratio, ratio);

    if (!sigState.padInstance) {
        sigState.padInstance = new SignaturePad(canvas, {
            penColor:  'blue',
            minWidth:  1.0,
            maxWidth:  2.5,
        });
    } else {
        sigState.padInstance.clear();
    }
}

function clearSignaturePad() {
    if (sigState.padInstance) sigState.padInstance.clear();
}

// Legacy stubs (ไม่ใช้แล้วแต่ป้องกัน error ถ้าโค้ดเก่าเรียก)
function openSignaturePadModal()  {}
function closeSignaturePadModal() {}

// ============================================================
// 3. วางลายเซ็นบน PDF — สร้าง draggable overlay
// ============================================================
function placeSignatureOnPdf() {
    if (!sigState.padInstance || sigState.padInstance.isEmpty()) {
        alert('กรุณาวาดลายเซ็นก่อนกดวาง');
        return;
    }
    const dataURL = sigState.padInstance.toDataURL('image/png');
    sigState.lastSigDataURL = dataURL;
    _createSignaturePlacement(dataURL);
    document.getElementById('btn-dup-sig').classList.remove('hidden');
}

function duplicateLastSignature() {
    if (!sigState.lastSigDataURL) return;
    _createSignaturePlacement(sigState.lastSigDataURL);
}

function clearAllSignaturePlacements() {
    sigState.placements.forEach(p => { try { p.el.remove(); } catch(e) {} });
    sigState.placements = [];
    document.getElementById('btn-dup-sig').classList.add('hidden');
}

function _createSignaturePlacement(dataURL) {
    const container = document.getElementById('signature-pdf-container');
    const canvas    = document.getElementById('signature-pdf-canvas');

    // ตำแหน่งเริ่มต้น: กลางพื้นที่ที่มองเห็น
    const initLeft = canvas.offsetLeft + Math.max(0, (canvas.offsetWidth  - 120) / 2);
    const initTop  = container.scrollTop + Math.max(60, (container.clientHeight / 2) - 30);

    const el = document.createElement('div');
    el.className  = 'sig-placement';
    el.style.cssText = [
        'position:absolute',
        `left:${initLeft}px`,
        `top:${initTop}px`,
        'width:120px',
        'cursor:grab',
        'user-select:none',
        'z-index:20',
        'touch-action:none',
    ].join(';');

    el.innerHTML = `
        <img src="${dataURL}"
            style="width:100%;display:block;border:2px dashed #3b82f6;border-radius:4px;background:rgba(255,255,255,0.85);">
        <button
            style="position:absolute;top:-10px;right:-10px;background:#ef4444;color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.3);padding:0;">
            ✕
        </button>
        <div class="sig-resize-handle"
            style="position:absolute;bottom:-7px;right:-7px;width:16px;height:16px;background:#3b82f6;border-radius:3px;cursor:nwse-resize;z-index:21;touch-action:none;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.35);"
            title="ลากเพื่อปรับขนาด">
            <svg width="10" height="10" viewBox="0 0 10 10" style="pointer-events:none;">
                <line x1="2" y1="9" x2="9" y2="2" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
                <line x1="5" y1="9" x2="9" y2="5" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
        </div>
    `;

    // ปุ่ม ✕ ลบตัวเอง
    el.querySelector('button').addEventListener('click', (e) => {
        e.stopPropagation();
        sigState.placements = sigState.placements.filter(p => p.el !== el);
        el.remove();
        if (sigState.placements.length === 0) {
            document.getElementById('btn-dup-sig').classList.add('hidden');
        }
    });

    container.appendChild(el);
    _makeDraggable(el);
    _makeResizable(el);
    sigState.placements.push({ el, sigDataURL: dataURL });
}

// ============================================================
// 4. Draggable helper (mouse + touch)
// ============================================================
function _makeDraggable(el) {
    let startX, startY, startLeft, startTop;

    function onStart(e) {
        if (e.target.tagName === 'BUTTON') return;            // ไม่ drag เมื่อกด ✕
        if (e.target.closest?.('.sig-resize-handle')) return; // ไม่ drag เมื่อ resize
        e.preventDefault();
        const pt    = e.touches ? e.touches[0] : e;
        startX      = pt.clientX;
        startY      = pt.clientY;
        startLeft   = parseFloat(el.style.left) || 0;
        startTop    = parseFloat(el.style.top)  || 0;
        el.style.cursor = 'grabbing';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onEnd);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend',  onEnd);
    }

    function onMove(e) {
        e.preventDefault();
        const pt = e.touches ? e.touches[0] : e;
        el.style.left = `${startLeft + (pt.clientX - startX)}px`;
        el.style.top  = `${startTop  + (pt.clientY - startY)}px`;
    }

    function onEnd() {
        el.style.cursor = 'grab';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend',  onEnd);
    }

    el.addEventListener('mousedown',  onStart);
    el.addEventListener('touchstart', onStart, { passive: false });
}

// ============================================================
// 4b. Resizable helper (mouse + touch) — ย่อ-ขยายลายเซ็น
// ============================================================
function _makeResizable(el) {
    const handle = el.querySelector('.sig-resize-handle');
    if (!handle) return;

    let startX, startW;

    function onStart(e) {
        e.stopPropagation();
        e.preventDefault();
        const pt = e.touches ? e.touches[0] : e;
        startX   = pt.clientX;
        startW   = el.offsetWidth;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onEnd);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend',  onEnd);
    }

    function onMove(e) {
        e.preventDefault();
        const pt   = e.touches ? e.touches[0] : e;
        const dx   = pt.clientX - startX;
        const newW = Math.min(400, Math.max(40, startW + dx));
        el.style.width = `${newW}px`;
    }

    function onEnd() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend',  onEnd);
    }

    handle.addEventListener('mousedown',  onStart);
    handle.addEventListener('touchstart', onStart, { passive: false });
}

// ============================================================
// 5. ยืนยัน: ฝังลายเซ็นทุกจุดลง PDF → อัปโหลด → อัปเดตสถานะ
// ============================================================
async function applySignatureToPdf() {
    if (sigState.placements.length === 0) {
        alert('กรุณาวางลายเซ็นบน PDF อย่างน้อย 1 จุดก่อนยืนยัน');
        return;
    }
    try {
        toggleLoader('btn-confirm-signature', true);

        // ── 1. คำนวณตำแหน่งและฝังลายเซ็นลง PDF ──
        // Snapshot ตำแหน่งจริงบนจอก่อน await เพื่อป้องกัน scroll เปลี่ยนค่า
        const canvas     = document.getElementById('signature-pdf-canvas');
        const canvasRect = canvas.getBoundingClientRect();

        const placementSnapshots = sigState.placements.map(({ el, sigDataURL }) => {
            const elRect = el.getBoundingClientRect();
            return {
                sigDataURL,
                xInCanvas: elRect.left - canvasRect.left,
                yInCanvas: elRect.top  - canvasRect.top,
                sigCssW:   elRect.width,
                sigCssH:   elRect.height,
            };
        });

        const pdfDoc  = await PDFLib.PDFDocument.load(sigState.pdfBytes);
        const page    = pdfDoc.getPages()[0];
        const pdfW    = page.getWidth();
        const pdfH    = page.getHeight();
        // อัตราส่วน CSS pixel → PDF point (ตาม canvas ที่แสดงจริงบนจอ)
        const ratioX  = pdfW / canvasRect.width;
        const ratioY  = pdfH / canvasRect.height;

        for (const { sigDataURL, xInCanvas, yInCanvas, sigCssW, sigCssH } of placementSnapshots) {
            // ขนาดลายเซ็นใน PDF units สัดส่วนเดียวกับที่เห็นบนจอ
            const sigPdfW = sigCssW * ratioX;
            const sigPdfH = sigCssH * ratioY;
            const pdfX    = xInCanvas * ratioX;
            const pdfY    = pdfH - (yInCanvas * ratioY) - sigPdfH;
            const img     = await pdfDoc.embedPng(sigDataURL);
            page.drawImage(img, { x: pdfX, y: pdfY, width: sigPdfW, height: sigPdfH });
        }

        const finalBytes  = await pdfDoc.save();
        const signedBlob  = new Blob([finalBytes], { type: 'application/pdf' });

        // ── 2. ปิด Modal ก่อนอัปโหลด ──
        closeSignatureModal();
        showAlert('กำลังดำเนินการ', 'กำลังบันทึกเอกสารที่ลงนามแล้ว... กรุณารอสักครู่', false);

        const user   = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
        const docId  = sigState.docId;
        const safeId = docId ? docId.replace(/[\/\\:\.]/g, '-') : 'unknown';

        const newPdfUrl = await uploadPdfToStorage(
            signedBlob, user?.username || 'approver',
            `signed_${safeId}.pdf`
        );
        const nextStatus  = getNextDocStatus(sigState.currentDocStatus);

        // ── 3. อ่าน docType เพื่อแยกการอัพเดตบันทึก vs คำสั่ง ──
        let existingDocType = 'memo';
        if (typeof db !== 'undefined' && nextStatus === 'อนุมัติ') {
            try {
                const snap = await db.collection('requests').doc(safeId).get();
                existingDocType = snap.data()?.docType || 'memo';
            } catch(_) {}
        }
        const isCommandDoc = existingDocType === 'command';

        // ── 4. อัปเดต Firestore ──
        if (typeof db !== 'undefined') {
            const effectiveRole = user?._approverRole || user?.role || '';
            const update = {
                pdfUrl:        newPdfUrl,
                currentPdfUrl: newPdfUrl,
                memoPdfUrl:    newPdfUrl,
                lastUpdated:   firebase.firestore.FieldValue.serverTimestamp(),
            };
            if (nextStatus) update.docStatus = nextStatus;
            if (effectiveRole) {
                update[`signedBy_${effectiveRole}`] = user?.name || user?.username || '';
                update[`signedAt_${effectiveRole}`] = firebase.firestore.FieldValue.serverTimestamp();
            }

            // 💾 อัปเดต pdfBase64 ใน Firestore (PDF ล่าสุดหลังลงนาม)
            if (nextStatus === 'อนุมัติ') {
                // ✅ ขั้นตอนสุดท้าย: ลบ cache ออก (ประหยัด Firestore space, Drive ยังเก็บครบ)
                update.pdfBase64 = firebase.firestore.FieldValue.delete();
                // ★ แยก field ตามประเภทเอกสาร ไม่ปนกัน
                if (isCommandDoc) {
                    update.commandStatus       = 'รับไฟล์กลับไปใช้งาน';
                    update.completedCommandUrl = newPdfUrl;
                } else {
                    update.status           = 'รับไฟล์กลับไปใช้งาน';
                    update.completedMemoUrl = newPdfUrl;
                }
                console.log(`✅ ${isCommandDoc ? 'Command' : 'Memo'} fully approved — file URL returned to user`);
            } else {
                // 📦 ขั้นตอนกลาง: cache PDF ที่มีลายเซ็นแล้วเพื่อให้ผู้ลงนามคนถัดไปโหลดได้เร็ว
                try {
                    const base64Data = btoa(
                        finalBytes.reduce((acc, byte) => acc + String.fromCharCode(byte), '')
                    );
                    if (base64Data.length <= 900_000) {
                        update.pdfBase64 = base64Data;
                    }
                } catch (_) { /* ถ้า convert ไม่ได้ก็ไม่ cache — ยังทำงานได้จาก Storage */ }
            }

            await db.collection('requests').doc(safeId).set(update, { merge: true });
        }

        // ── 5. อัปเดต Google Sheet (non-blocking) ──
        const sheetPayload = {
            requestId: docId,
            pdfUrl:    newPdfUrl,
            docStatus: nextStatus || sigState.currentDocStatus,
        };
        if (nextStatus === 'อนุมัติ') {
            if (isCommandDoc) {
                sheetPayload.commandStatus      = 'รับไฟล์กลับไปใช้งาน';
                sheetPayload.completedCommandUrl = newPdfUrl;
            } else {
                sheetPayload.status           = 'รับไฟล์กลับไปใช้งาน';
                sheetPayload.completedMemoUrl = newPdfUrl;
            }
        }
        apiCall('POST', 'updateRequest', sheetPayload).catch(e => console.warn('Sheet update error:', e));

        document.getElementById('alert-modal').style.display = 'none';

        // ── 5. แจ้งผลลัพธ์ ──
        if (window._currentSignToken) {
            // Token Page: mark used + แสดงสำเร็จ
            await markCurrentTokenUsed();
            if (typeof showTokenSignSuccess === 'function') {
                showTokenSignSuccess(nextStatus, null);
            }
        } else {
            // Dashboard: alert + reload inbox
            showAlert(
                '✅ ลงนามสำเร็จ',
                nextStatus
                    ? `เอกสารถูกส่งต่อไปยัง: ${getDocStatusLabel(nextStatus)} เรียบร้อยแล้ว`
                    : 'ลงนามเอกสารเรียบร้อยแล้ว'
            );
            if (typeof loadPendingApprovals === 'function') loadPendingApprovals();
        }

    } catch (e) {
        console.error('applySignatureToPdf error:', e);
        try { document.getElementById('alert-modal').style.display = 'none'; } catch(_) {}
        alert('เกิดข้อผิดพลาดในการประทับลายเซ็น: ' + e.message);
    } finally {
        toggleLoader('btn-confirm-signature', false);
    }
}
