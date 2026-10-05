import api from '../../../core/services/api';

/**
 * Upload a purchase bill image manually (from the Purchase page).
 * @param {FormData} formData - must include a field named "bill" (the image file)
 */
export const uploadPurchaseBill = async (formData) => {
    const response = await api.post('/purchase/upload-bill', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
    });
    return response.data;
};

/**
 * Get all purchase records for the store.
 */
export const getPurchases = async () => {
    const response = await api.get(`/purchase/?_t=${Date.now()}`);
    return response.data;
};

/**
 * Get auto-import purchase bills (Admin endpoint)
 */
export const getAutoImportBills = async () => {
    const response = await api.get(`/purchase/admin/auto-import?_t=${Date.now()}`);
    return response.data;
};

/**
 * Delete a purchase record by ID.
 */
export const deletePurchase = async (id) => {
    const response = await api.delete(`/purchase/${id}`);
    return response.data;
};

/**
 * Finalize a pending auto-import purchase record after the user confirms.
 * Marks it as 'received' and fills in supplier / total / items_count metadata.
 *
 * @param {string} purchaseId   - the _id returned by /product/auto-import
 * @param {Object} meta         - { supplier_name, total_amount, items_count }
 */
export const finalizePurchase = async (purchaseId, meta) => {
    const response = await api.patch(`/purchase/${purchaseId}/finalize`, meta);
    return response.data;
};

export const createPurchaseDraft = async (draftData) => {
    const response = await api.post('/purchase/draft', draftData);
    return response.data;
};

export const createManualPurchase = async (purchaseData) => {
    const response = await api.post(`/purchase/manual`, purchaseData);
    return response.data;
};

export const savePurchaseJson = async (id, payload) => {
    const response = await api.patch(`/purchase/${id}/save-json`, payload);
    return response.data;
};

/**
 * Upload a purchase bill for AI parsing via server-side proxy.
 * The server forwards the image to bill-to-json.onrender.com — avoids CORS.
 * @param {FormData} formData - must include a field named "bill"
 */
export const autoImportBill = async (formData) => {
    const response = await api.post('/purchase/ai-import/parse-bill', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 100000, // 100 s — external API can be slow on cold start
    });
    return response.data;
};

/**
 * Confirm and finalize auto-import items.
 * Hits product/auto-import/confirm to update stock.
 * @param {Object} data - { items: [...] }
 */
export const confirmAutoImport = async (data) => {
    const response = await api.post('/product/auto-import/confirm', data);
    return response.data;
};

// ─── Background AI Import Job API ─────────────────────────────────────────

/**
 * Start a new background AI import job.
 * Returns immediately with job_id — processing happens server-side.
 * @param {FormData} formData - images field (up to 10 images)
 */
export const startAiImportJob = async (formData) => {
    const response = await api.post('/purchase/ai-import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000, // Just upload, no waiting for AI
    });
    return response.data;
};

/**
 * Get all AI import jobs for the current store.
 * @param {string} [status] - optional filter: 'processing'|'review_ready'|'low_confidence'|'confirmed'|'rejected'|'failed'
 */
export const getAiImportJobs = async (status) => {
    const url = status ? `/purchase/ai-import/jobs?status=${status}` : `/purchase/ai-import/jobs?_t=${Date.now()}`;
    const response = await api.get(url);
    return response.data;
};

/**
 * Confirm an AI import job — creates Purchase record + updates inventory.
 * @param {Object} data - { job_id, items, supplier_name, bill_no, total_amount }
 */
export const confirmAiImportJob = async (data) => {
    const response = await api.post('/purchase/ai-import/confirm', data);
    return response.data;
};

/**
 * Reject/discard an AI import job.
 * @param {string} jobId
 */
export const rejectAiImportJob = async (jobId) => {
    const response = await api.patch(`/purchase/ai-import/${jobId}/reject`);
    return response.data;
};
