import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    FlatList,
    ActivityIndicator,
    Alert,
    Modal,
    ScrollView,
    Platform,
    Image,
    Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../../core/constants/theme';
import { useResponsive } from '../../../core/utils/responsive';
import { uploadPurchaseBill, getPurchases, deletePurchase, createManualPurchase, autoImportBill, confirmAutoImport, finalizePurchase } from '../services/purchaseService';

// ─── File picker helper (web only — uses <input type="file"> ────────────────
const pickFileWeb = () =>
    new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf,image/*';
        input.onchange = (e) => {
            const file = e.target.files?.[0] ?? null;
            resolve(file);
        };
        input.click();
    });

// ─── Format date helper ─────────────────────────────────────────────────────
const formatDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

// ─── Bill Image Preview Modal ───────────────────────────────────────────────
const ImagePreviewModal = ({ visible, imageUrl, onClose }) => (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={previewStyles.overlay}>
            <View style={previewStyles.container}>
                <View style={previewStyles.header}>
                    <Text style={previewStyles.title}>Bill Image</Text>
                    <TouchableOpacity onPress={onClose} style={previewStyles.closeBtn}>
                        <Ionicons name="close" size={20} color={COLORS.textMuted} />
                    </TouchableOpacity>
                </View>
                <View style={previewStyles.imageWrap}>
                    {imageUrl ? (
                        <Image
                            source={{ uri: imageUrl }}
                            style={previewStyles.image}
                            resizeMode="contain"
                        />
                    ) : (
                        <View style={previewStyles.noImage}>
                            <Ionicons name="image-outline" size={48} color={COLORS.border} />
                            <Text style={previewStyles.noImageText}>No image available</Text>
                        </View>
                    )}
                </View>
                <View style={previewStyles.footer}>
                    <TouchableOpacity style={previewStyles.closeBtnFull} onPress={onClose}>
                        <Text style={previewStyles.closeBtnText}>Close</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    </Modal>
);

const previewStyles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    container: {
        width: '85%',
        maxWidth: 640,
        backgroundColor: COLORS.white,
        borderRadius: 2,
        overflow: 'hidden',
        borderWidth: 0.5,
        borderColor: COLORS.border,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
        backgroundColor: COLORS.bgSurface,
    },
    title: { fontSize: 13, fontWeight: '600', color: COLORS.textPrimary },
    closeBtn: {
        width: 28,
        height: 28,
        borderRadius: 2,
        backgroundColor: COLORS.bgDark,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 0.5,
        borderColor: COLORS.border,
    },
    imageWrap: {
        height: 420,
        backgroundColor: '#f0f0f0',
        alignItems: 'center',
        justifyContent: 'center',
    },
    image: { width: '100%', height: '100%' },
    noImage: { alignItems: 'center', gap: 8 },
    noImageText: { fontSize: 13, color: COLORS.textMuted },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: 10,
        borderTopWidth: 0.5,
        borderTopColor: COLORS.border,
        backgroundColor: COLORS.bgSurface,
        justifyContent: 'flex-end',
    },
    openBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 30,
        paddingHorizontal: 10,
        borderRadius: 2,
        borderWidth: 0.5,
        borderColor: COLORS.primary,
        backgroundColor: COLORS.primaryGhost,
    },
    openBtnText: { fontSize: 11, fontWeight: '600', color: COLORS.primary },
    closeBtnFull: {
        height: 30,
        paddingHorizontal: 12,
        borderRadius: 2,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        backgroundColor: COLORS.white,
        alignItems: 'center',
        justifyContent: 'center',
    },
    closeBtnText: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary },
});

// ═══════════════════════════════════════════════════════════════════════════
// ANIMATED PROGRESS BAR (SMOOTH INCREMENT)
// ═══════════════════════════════════════════════════════════════════════════
const AnimatedProgressBar = ({ baseProgress }) => {
    const [displayProgress, setDisplayProgress] = useState(baseProgress || 0);

    useEffect(() => {
        if (baseProgress > displayProgress) {
            setDisplayProgress(baseProgress);
        }
    }, [baseProgress]);

    useEffect(() => {
        const interval = setInterval(() => {
            setDisplayProgress(prev => {
                if (prev < 95 && prev >= (baseProgress || 0)) {
                    return prev + 1; // Increment by 1% every 1.5s while waiting for next backend update
                }
                return prev;
            });
        }, 1500);
        return () => clearInterval(interval);
    }, [baseProgress]);

    return (
        <View style={{ width: '100%', minWidth: 70, maxWidth: 100, marginLeft: 'auto' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 9, color: COLORS.textMuted }}>AI Processing</Text>
                <Text style={{ fontSize: 9, color: COLORS.primary, fontWeight: '700' }}>{displayProgress}%</Text>
            </View>
            <View style={{ height: 4, backgroundColor: '#E2E8F0', borderRadius: 2, overflow: 'hidden' }}>
                <View style={{ height: '100%', width: `${displayProgress}%`, backgroundColor: COLORS.primary }} />
            </View>
        </View>
    );
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════
export default function PurchaseScreen({ route, navigation }) {
    const r = useResponsive();

    const [purchases, setPurchases] = useState([]);
    const [filteredPurchases, setFilteredPurchases] = useState([]);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterDate, setFilterDate] = useState('');

    // Draft Step 1 modal state
    const [draftModalVisible, setDraftModalVisible] = useState(false);
    const [draftLoading, setDraftLoading] = useState(false);
    const [draftSelectedFile, setDraftSelectedFile] = useState(null);
    const [draftForm, setDraftForm] = useState({
        supplier_name: '',
        bill_no: '',
        bill_date: '',
        notes: '',
    });

    // Upload state
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState('');
    const [uploadSuccessModalVisible, setUploadSuccessModalVisible] = useState(false);
    const [autoImportNoticeVisible, setAutoImportNoticeVisible] = useState(false);
    const [underWorkModalVisible, setUnderWorkModalVisible] = useState(false);
    const [uploadHints, setUploadHints] = useState({ supplier_name: '', bill_date: '', total_amount: '' });

    // Preview modal
    const [previewUrl, setPreviewUrl] = useState(null);
    const [previewVisible, setPreviewVisible] = useState(false);

    // Manual Purchase modal
    const [manualPurchaseModalVisible, setManualPurchaseModalVisible] = useState(false);
    const [manualPurchaseLoading, setManualPurchaseLoading] = useState(false);
    const [manualPurchaseForm, setManualPurchaseForm] = useState({
        supplier_name: '',
        supplier_gstin: '',
        bill_no: '',
        bill_date: '',
        notes: '',
        items: [],
        taxable_amount: 0,
        cgst_amount: 0,
        sgst_amount: 0,
        total_amount: 0,
        purchase_id: null,
        bill_image_url: null,
    });

    // Delete confirm
    const [deletingId, setDeletingId] = useState(null);
    const [deleteModalVisible, setDeleteModalVisible] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);

    // Auto Import Review modal
    const [reviewModalVisible, setReviewModalVisible] = useState(false);
    const [reviewPurchaseId, setReviewPurchaseId] = useState(null);
    const [reviewLoading, setReviewLoading] = useState(false);
    const [reviewItems, setReviewItems] = useState([]);
    const [reviewMetadata, setReviewMetadata] = useState({});

    // ─── FETCH ─────────────────────────────────────────────────────────────
    const previousPurchasesRef = useRef([]);
    const initialLoadRef = useRef(true);

    const fetchPurchases = useCallback(async (isPolling = false) => {
        if (!isPolling) setLoading(true);
        try {
            const res = await getPurchases();
            const newPurchases = res?.data ?? [];
            setPurchases(newPurchases);
            setFilteredPurchases(newPurchases);

            if (!initialLoadRef.current) {
                const oldPurchasesMap = new Map(previousPurchasesRef.current.map(p => [p._id, p]));
                const newlyNeedsReview = newPurchases.filter(p => {
                    const oldP = oldPurchasesMap.get(p._id);
                    return p.needs_manual_review && (!oldP || !oldP.needs_manual_review);
                });

                if (newlyNeedsReview.length > 0) {
                    // Alert logic moved to MainLayout bell icon
                }
            }

            previousPurchasesRef.current = newPurchases;
            initialLoadRef.current = false;
        } catch (err) {
            console.warn('Fetch purchases failed:', err.message);
            if (!isPolling) {
                setPurchases([]);
                setFilteredPurchases([]);
            }
        } finally {
            if (!isPolling) setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchPurchases();
        
        // Poll every 10 seconds
        const intervalId = setInterval(() => {
            fetchPurchases(true);
        }, 10000);

        return () => clearInterval(intervalId);
    }, [fetchPurchases]);

    useEffect(() => {
        if (route?.params?.openAddModal) {
            setManualPurchaseModalVisible(true);
            navigation.setParams({ openAddModal: undefined });
        }
    }, [route?.params?.openAddModal, navigation]);

    useEffect(() => {
        let filtered = purchases;

        // Text filter
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(p =>
                (p.supplier_name || '').toLowerCase().includes(q)
            );
        }

        // Date filter — single day
        if (filterDate) {
            const dayStart = new Date(filterDate + 'T00:00:00');
            const dayEnd = new Date(filterDate + 'T23:59:59');
            filtered = filtered.filter(p => {
                const d = new Date(p.bill_date || p.createdAt);
                return d >= dayStart && d <= dayEnd;
            });
        }

        setFilteredPurchases(filtered);
    }, [searchQuery, filterDate, purchases]);

    const onRefresh = async () => {
        setRefreshing(true);
        await fetchPurchases();
        setRefreshing(false);
    };

    // ─── MANUAL PURCHASE ──────────────────────────────────────────────────
    const handleManualPurchaseItemChange = (index, field, value) => {
        const newItems = [...manualPurchaseForm.items];
        
        if (field === 'expiry_date') {
            let formatted = value.replace(/\D/g, '');
            if (formatted.length > 4) {
                formatted = formatted.substring(0, 4);
            }
            if (formatted.length >= 3) {
                formatted = formatted.substring(0, 2) + '/' + formatted.substring(2);
            }
            value = formatted;
        }

        newItems[index][field] = value;
        
        let taxable = 0;
        let cgst = 0;
        let sgst = 0;
        newItems.forEach(item => {
            const qty = Number(item.quantity) || 0;
            const rate = Number(item.rate) || 0;
            const discount = Number(item.discount) || 0;
            const discountedRate = rate - (rate * (discount / 100));
            const itemTaxable = qty * discountedRate;
            const itemGst = Number(item.gst) || 0;
            const itemGstAmt = (itemTaxable * itemGst) / 100;
            
            taxable += itemTaxable;
            cgst += itemGstAmt / 2;
            sgst += itemGstAmt / 2;
        });
        
        setManualPurchaseForm({
            ...manualPurchaseForm,
            items: newItems,
            taxable_amount: taxable,
            cgst_amount: cgst,
            sgst_amount: sgst,
            total_amount: taxable + cgst + sgst
        });
    };

    const addManualPurchaseItem = () => {
        setManualPurchaseForm({
            ...manualPurchaseForm,
            items: [
                ...manualPurchaseForm.items,
                { medicine_name: '', mrp: '', quantity: '', batch_number: '', expiry_date: '', hsn_code: '', gst: '', rate: '', discount: '' }
            ]
        });
    };

    const removeManualPurchaseItem = (index) => {
        const newItems = manualPurchaseForm.items.filter((_, i) => i !== index);
        let taxable = 0;
        let cgst = 0;
        let sgst = 0;
        newItems.forEach(item => {
            const qty = Number(item.quantity) || 0;
            const rate = Number(item.rate) || 0;
            const discount = Number(item.discount) || 0;
            const discountedRate = rate - (rate * (discount / 100));
            const itemTaxable = qty * discountedRate;
            const itemGst = Number(item.gst) || 0;
            const itemGstAmt = (itemTaxable * itemGst) / 100;
            taxable += itemTaxable;
            cgst += itemGstAmt / 2;
            sgst += itemGstAmt / 2;
        });
        setManualPurchaseForm({
            ...manualPurchaseForm,
            items: newItems,
            taxable_amount: taxable,
            cgst_amount: cgst,
            sgst_amount: sgst,
            total_amount: taxable + cgst + sgst
        });
    };

    const handleOpenAddPurchase = () => {
        const today = new Date().toISOString().split('T')[0];
        setDraftForm({
            supplier_name: '',
            bill_no: '',
            bill_date: today,
            notes: '',
        });
        setDraftSelectedFile(null);
        setDraftModalVisible(true);
    };

    const handlePickDraftFile = async () => {
        const file = await pickFileWeb();
        if (file) {
            setDraftSelectedFile(file);
        }
    };

    const handleSaveDraft = async () => {
        setDraftLoading(true);
        try {
            if (draftSelectedFile) {
                const formData = new FormData();
                formData.append('bill', draftSelectedFile, draftSelectedFile.name);
                if (draftForm.supplier_name) formData.append('supplier_name', draftForm.supplier_name);
                if (draftForm.bill_no) formData.append('bill_no', draftForm.bill_no);
                if (draftForm.bill_date) formData.append('bill_date', draftForm.bill_date);
                if (draftForm.notes) formData.append('notes', draftForm.notes);
                formData.append('status', 'draft');
                formData.append('source', 'manual');

                await uploadPurchaseBill(formData);
            } else {
                await createPurchaseDraft({
                    ...draftForm,
                    status: 'draft',
                    source: 'manual',
                });
            }

            Alert.alert('Draft Saved', 'Purchase record saved as draft! You can complete inventory entry anytime from Purchase Records.');
            setDraftModalVisible(false);
            setDraftSelectedFile(null);
            setDraftForm({ supplier_name: '', bill_no: '', bill_date: '', notes: '' });
            await fetchPurchases();
        } catch (err) {
            console.error('Save draft error:', err);
            Alert.alert('Draft Error', err?.message || 'Could not save purchase draft.');
        } finally {
            setDraftLoading(false);
        }
    };

    const handleDirectFullPurchase = () => {
        setDraftModalVisible(false);
        setManualPurchaseForm({
            supplier_name: draftForm.supplier_name || '',
            supplier_gstin: '',
            bill_no: draftForm.bill_no || '',
            bill_date: draftForm.bill_date || '',
            notes: draftForm.notes || '',
            items: [],
            taxable_amount: 0,
            cgst_amount: 0,
            sgst_amount: 0,
            total_amount: 0,
            purchase_id: null,
            bill_image_url: null,
        });
        setManualPurchaseModalVisible(true);
    };

    const handleOpenDraft = (item) => {
        setManualPurchaseForm({
            supplier_name: item.supplier_name || '',
            supplier_gstin: item.supplier_gstin || '',
            bill_no: item.bill_no || '',
            bill_date: item.bill_date ? item.bill_date.split('T')[0] : '',
            notes: item.notes || '',
            items: item.extracted_items && item.extracted_items.length > 0 ? item.extracted_items.map(i => ({
                medicine_name: i.medicine_name || i.product_name || '',
                mrp: String(i.mrp || ''),
                quantity: String(i.quantity || ''),
                batch_number: i.batch_number || '',
                expiry_date: i.expiry_date || '',
                hsn_code: i.hsn_code || '',
                gst: String(i.gst || ''),
                rate: String(i.rate || i.cost_price || ''),
                discount: String(i.discount || '0'),
            })) : [],
            taxable_amount: item.taxable_amount || 0,
            cgst_amount: item.cgst_amount || 0,
            sgst_amount: item.sgst_amount || 0,
            total_amount: item.total_amount || 0,
            purchase_id: item._id,
            bill_image_url: item.bill_image_url || null,
        });
        setManualPurchaseModalVisible(true);
    };

    const handleSaveManualPurchase = async () => {
        if (!manualPurchaseForm.supplier_name.trim()) {
            Alert.alert('Validation Error', 'Supplier Name is required.');
            return;
        }
        if (manualPurchaseForm.items.length === 0) {
            Alert.alert('Validation Error', 'Please add at least one item.');
            return;
        }
        for (let i = 0; i < manualPurchaseForm.items.length; i++) {
            if (!manualPurchaseForm.items[i].medicine_name.trim()) {
                Alert.alert('Validation Error', `Item #${i + 1} must have a Product Name.`);
                return;
            }
        }

        setManualPurchaseLoading(true);
        try {
            const payload = { ...manualPurchaseForm };
            payload.items = payload.items.map(item => {
                let formattedExpiry = item.expiry_date;
                if (formattedExpiry && formattedExpiry.includes('/')) {
                    const parts = formattedExpiry.split('/');
                    if (parts.length === 2 && parts[0].length === 2 && parts[1].length === 2) {
                        const month = parseInt(parts[0], 10);
                        const year = 2000 + parseInt(parts[1], 10);
                        const lastDay = new Date(year, month, 0).getDate();
                        formattedExpiry = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
                    }
                }
                return { ...item, expiry_date: formattedExpiry };
            });

            await createManualPurchase(payload);
            Alert.alert('Success', 'Manual purchase saved successfully!');
            setManualPurchaseModalVisible(false);
            setManualPurchaseForm({
                supplier_name: '', supplier_gstin: '', bill_no: '', bill_date: '', notes: '',
                items: [], taxable_amount: 0, cgst_amount: 0, sgst_amount: 0, total_amount: 0,
                purchase_id: null, bill_image_url: null,
            });
            fetchPurchases();
        } catch (error) {
            Alert.alert('Error', error.message || 'Failed to save manual purchase.');
        } finally {
            setManualPurchaseLoading(false);
        }
    };

    const handleUploadBill = () => {
        setUnderWorkModalVisible(true);
    };

    const confirmUploadBill = async () => {
        setAutoImportNoticeVisible(false);
        try {
            let file = null;

            file = await pickFileWeb();
            
            if (!file) return; // user cancelled

            // Upload directly instead of opening modal
            setUploading(true);
            setUploadProgress('Uploading bill to cloud for AI processing...');

            const formData = new FormData();
            formData.append('bill', file, file.name);
            if (uploadHints.supplier_name) formData.append('supplier_name', uploadHints.supplier_name);
            if (uploadHints.bill_date) formData.append('bill_date', uploadHints.bill_date);
            if (uploadHints.total_amount) formData.append('total_amount', uploadHints.total_amount);

            await autoImportBill(formData);

            setUploadSuccessModalVisible(true);
            await fetchPurchases();

        } catch (err) {
            console.error('File pick or upload error:', err);
            Alert.alert('Upload Failed', err?.message || 'Could not start upload processing.');
        } finally {
            setUploading(false);
            setUploadProgress('');
        }
    };

    // ─── REVIEW AUTO IMPORT ────────────────────────────────────────────────
    const handleOpenReview = (item) => {
        setReviewPurchaseId(item._id);
        setReviewMetadata({
            supplier_name: item.supplier_name,
            total_amount: item.total_amount,
            items_count: item.items_count || (item.extracted_items || []).length
        });
        setReviewItems(item.extracted_items || []);
        setReviewModalVisible(true);
    };

    const handleReviewItemChange = (index, field, value) => {
        const newItems = [...reviewItems];
        newItems[index][field] = value;
        setReviewItems(newItems);
    };

    const handleReviewItemDelete = (index) => {
        const newItems = reviewItems.filter((_, i) => i !== index);
        setReviewItems(newItems);
    };

    const handleReviewConfirm = async () => {
        if (!reviewItems.length) {
            Alert.alert('Error', 'No items to confirm.');
            return;
        }

        setReviewLoading(true);
        try {
            const payload = {
                purchase_id: reviewPurchaseId,
                items: reviewItems,
                supplier_name: reviewMetadata.supplier_name,
                total_amount: reviewMetadata.total_amount,
            };
            
            // Confirm the items, creates/updates inventory and finalizes the purchase record
            await createManualPurchase(payload);

            Alert.alert('Success', 'Import confirmed and stock updated.');
            setReviewModalVisible(false);
            setReviewPurchaseId(null);
            setReviewItems([]);
            fetchPurchases();
        } catch (err) {
            console.error('Review confirm error:', err);
            Alert.alert('Error', err?.message || 'Failed to confirm import.');
        } finally {
            setReviewLoading(false);
        }
    };

    // ─── DELETE ────────────────────────────────────────────────────────────
    const confirmDelete = (id) => {
        setDeletingId(id);
        setDeleteModalVisible(true);
    };

    const handleDelete = async () => {
        if (!deletingId) return;
        setDeleteLoading(true);
        try {
            await deletePurchase(deletingId);
            setDeleteModalVisible(false);
            setDeletingId(null);
            await fetchPurchases();
        } catch (err) {
            Alert.alert('Error', err?.message || 'Failed to delete purchase');
        } finally {
            setDeleteLoading(false);
        }
    };

    // ─── PREVIEW ───────────────────────────────────────────────────────────
    const openPreview = (url) => {
        setPreviewUrl(url);
        setPreviewVisible(true);
    };

    // ─── MOBILE CARD ROW ──────────────────────────────────────────────────
    const renderMobileCard = ({ item, index }) => {
        const hasBill = !!item.bill_image_url;
        const statusLabel = item.status?.toUpperCase() ?? 'PENDING';
        return (
            <View style={styles.mobileCard}>
                {/* Card Header: Supplier + Status */}
                <View style={styles.mobileCardHeader}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.mobileCardSupplier} numberOfLines={1}>
                            {item.supplier_name || '— No Supplier —'}
                        </Text>
                        {item.supplier_gstin ? <Text style={styles.mobileCardGstin}>{item.supplier_gstin}</Text> : null}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                        {item.needs_manual_review && (
                            <View style={[styles.statusBadge, { backgroundColor: COLORS.warningLight, borderColor: COLORS.warning, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 }]}>
                                <Ionicons name="warning-outline" size={10} color={COLORS.warning} style={{ marginRight: 3 }} />
                                <Text style={[styles.statusText, { color: COLORS.warning }]}>REVIEW</Text>
                            </View>
                        )}
                        {item.status === 'processing' ? (
                            <AnimatedProgressBar baseProgress={item.processing_progress} />
                        ) : (
                            <View style={[styles.statusBadge, styles[`status_${item.status}`]]}>
                                <Text style={[styles.statusText, styles[`statusText_${item.status}`]]}>
                                    {statusLabel}
                                </Text>
                            </View>
                        )}
                    </View>
                </View>

                {/* Card Body: Key details in a 2-col grid */}
                <View style={styles.mobileCardBody}>
                    <View style={styles.mobileDetailRow}>
                        <View style={styles.mobileDetailItem}>
                            <Text style={styles.mobileDetailLabel}>Date</Text>
                            <Text style={styles.mobileDetailValue}>
                                {item.bill_date ? formatDate(item.bill_date) : formatDate(item.createdAt)}
                            </Text>
                        </View>
                        <View style={styles.mobileDetailItem}>
                            <Text style={styles.mobileDetailLabel}>Invoice No</Text>
                            <Text style={styles.mobileDetailValue}>{item.bill_no || '—'}</Text>
                        </View>
                    </View>
                    <View style={styles.mobileDetailRow}>
                        <View style={styles.mobileDetailItem}>
                            <Text style={styles.mobileDetailLabel}>Amount</Text>
                            <Text style={[styles.mobileDetailValue, { fontWeight: '600', color: COLORS.primary }]}>
                                {item.total_amount > 0 ? `₹${Number(item.total_amount).toFixed(2)}` : '—'}
                            </Text>
                        </View>
                        <View style={styles.mobileDetailItem}>
                            <Text style={styles.mobileDetailLabel}>Items</Text>
                            <Text style={styles.mobileDetailValue}>
                                {item.items_count > 0 ? item.items_count : '—'}
                            </Text>
                        </View>
                    </View>
                </View>

                {/* Card Footer: Actions */}
                <View style={styles.mobileCardFooter}>
                    {hasBill ? (
                        <TouchableOpacity
                            style={styles.viewBillBtn}
                            onPress={() => openPreview(item.bill_image_url)}
                        >
                            <Ionicons name="image-outline" size={13} color={COLORS.primary} style={{ marginRight: 4 }} />
                            <Text style={styles.viewBillText}>View Bill</Text>
                        </TouchableOpacity>
                    ) : (
                        <View style={styles.noBillBadge}>
                            <Text style={styles.noBillText}>No Bill</Text>
                        </View>
                    )}
                    {item.status === 'draft' ? (
                        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                            <TouchableOpacity style={[styles.btnPrimary, { height: 28, paddingHorizontal: 10, backgroundColor: '#D97706' }]} onPress={() => handleOpenDraft(item)}>
                                <Text style={styles.btnPrimaryText}>Complete Purchase</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.actionBtn, styles.actionBtnDanger]}
                                onPress={() => confirmDelete(item._id)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                                <Ionicons name="trash-outline" size={13} color={COLORS.error} />
                            </TouchableOpacity>
                        </View>
                    ) : (item.status === 'pending' && item.source === 'auto_import' && item.needs_manual_review) ? (
                        <TouchableOpacity style={[styles.btnPrimary, {height: 28, paddingHorizontal: 10}]} onPress={() => handleOpenReview(item)}>
                            <Text style={styles.btnPrimaryText}>Ready for Review</Text>
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity
                            style={[styles.actionBtn, styles.actionBtnDanger]}
                            onPress={() => confirmDelete(item._id)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                            <Ionicons name="trash-outline" size={13} color={COLORS.error} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        );
    };

    // ─── DESKTOP TABLE ROW ─────────────────────────────────────────────────
    const renderRow = ({ item, index }) => {
        const hasBill = !!item.bill_image_url;
        return (
            <View style={[styles.tableRow, index % 2 === 0 && styles.tableRowAlt]}>
                {/* # */}
                <View style={[styles.cell, { width: 44, alignItems: 'center' }]}>
                    <Text style={styles.cellMuted}>{index + 1}</Text>
                </View>
                {/* Date / Inv No */}
                <View style={[styles.cell, { flex: 1.6 }]}>
                    <Text style={styles.cellText}>{item.bill_date ? formatDate(item.bill_date) : formatDate(item.createdAt)}</Text>
                    {item.bill_no ? <Text style={styles.cellMuted}>{item.bill_no}</Text> : null}
                </View>
                {/* Supplier / GSTIN */}
                <View style={[styles.cell, { flex: 1.8 }]}>
                    <Text style={styles.cellText} numberOfLines={1}>
                        {item.supplier_name || <Text style={{ color: COLORS.textMuted, fontStyle: 'italic' }}>—</Text>}
                    </Text>
                    {item.supplier_gstin ? <Text style={styles.cellMuted}>{item.supplier_gstin}</Text> : null}
                </View>
                {/* Items */}
                <View style={[styles.cell, { flex: 0.8, alignItems: 'center' }]}>
                    <Text style={styles.cellText}>
                        {item.items_count > 0 ? item.items_count : '—'}
                    </Text>
                </View>
                {/* Amount */}
                <View style={[styles.cell, { flex: 1.2, alignItems: 'center' }]}>
                    <Text style={styles.cellText}>
                        {item.total_amount > 0 ? `₹${Number(item.total_amount).toFixed(2)}` : '—'}
                    </Text>
                </View>
                {/* Bill Image */}
                <View style={[styles.cell, { flex: 1.2, alignItems: 'center' }]}>
                    {hasBill ? (
                        <TouchableOpacity
                            style={styles.viewBillBtn}
                            onPress={() => openPreview(item.bill_image_url)}
                        >
                            <Ionicons name="image-outline" size={13} color={COLORS.primary} style={{ marginRight: 4 }} />
                            <Text style={styles.viewBillText}>View Bill</Text>
                        </TouchableOpacity>
                    ) : (
                        <View style={styles.noBillBadge}>
                            <Text style={styles.noBillText}>No Bill</Text>
                        </View>
                    )}
                </View>
                {/* Status */}
                <View style={[styles.cell, { flex: 1, alignItems: 'center', gap: 4 }]}>
                    {item.needs_manual_review && (
                        <View style={[styles.statusBadge, { backgroundColor: COLORS.warningLight, borderColor: COLORS.warning, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, marginBottom: 4 }]}>
                            <Ionicons name="warning-outline" size={10} color={COLORS.warning} style={{ marginRight: 3 }} />
                            <Text style={[styles.statusText, { color: COLORS.warning }]}>REVIEW</Text>
                        </View>
                    )}
                    {item.status === 'processing' ? (
                        <AnimatedProgressBar baseProgress={item.processing_progress} />
                    ) : (
                        <View style={[styles.statusBadge, styles[`status_${item.status}`]]}>
                            <Text style={[styles.statusText, styles[`statusText_${item.status}`]]}>
                                {item.status?.toUpperCase() ?? 'PENDING'}
                            </Text>
                        </View>
                    )}
                </View>
                {/* Actions */}
                <View style={[styles.cell, { flex: 0.8, alignItems: 'center', borderRightWidth: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 }]}>
                    {item.status === 'draft' ? (
                        <View style={{ flexDirection: 'row', gap: 4 }}>
                            <TouchableOpacity style={[styles.btnPrimary, { height: 26, paddingHorizontal: 8, backgroundColor: '#D97706' }]} onPress={() => handleOpenDraft(item)}>
                                <Text style={[styles.btnPrimaryText, { fontSize: 10 }]}>Complete</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.actionBtn, styles.actionBtnDanger]}
                                onPress={() => confirmDelete(item._id)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                                <Ionicons name="trash-outline" size={13} color={COLORS.error} />
                            </TouchableOpacity>
                        </View>
                    ) : (item.status === 'pending' && item.source === 'auto_import' && item.needs_manual_review) ? (
                        <TouchableOpacity style={[styles.btnPrimary, {height: 26, paddingHorizontal: 8}]} onPress={() => handleOpenReview(item)}>
                            <Text style={[styles.btnPrimaryText, {fontSize: 10}]}>Review</Text>
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity
                            style={[styles.actionBtn, styles.actionBtnDanger]}
                            onPress={() => confirmDelete(item._id)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                            <Ionicons name="trash-outline" size={13} color={COLORS.error} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        );
    };

    return (
        <View style={[styles.container, r.isSmall && { padding: 10, overflow: 'hidden' }]}>

            {/* ─── HEADER ─── */}
            <View style={[styles.header, r.isSmall && styles.headerMobile]}>
                <View style={{ flexShrink: 1, minWidth: 0 }}>
                    <Text style={styles.headerTitle}>Purchase Orders</Text>
                    <Text style={styles.headerSub} numberOfLines={r.isSmall ? 2 : 1}>
                        {filteredPurchases.length} record{filteredPurchases.length !== 1 ? 's' : ''}{r.isSmall ? '' : ' · Bills uploaded from inventory AI import'}
                    </Text>
                </View>

                <View style={[styles.headerActions, r.isSmall && styles.headerActionsMobile]}>
                    {/* Manual Purchase & Upload Bill */}
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                            style={[styles.btnSecondary, r.isSmall && { height: 38 }]}
                            onPress={() => fetchPurchases()}
                        >
                            <Ionicons name="refresh" size={14} color={COLORS.primary} style={{ marginRight: 6 }} />
                            <Text style={[styles.btnSecondaryText, { color: COLORS.primary }]}>Refresh</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.btnSecondary, r.isSmall && { height: 38 }]}
                            onPress={handleOpenAddPurchase}
                        >
                            <Ionicons name="add-circle-outline" size={14} color={COLORS.primary} style={{ marginRight: 6 }} />
                            <Text style={[styles.btnSecondaryText, { color: COLORS.primary }]}>Add Purchase</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.btnPrimary, r.isSmall && { height: 38 }]}
                            onPress={handleUploadBill}
                            disabled={uploading}
                        >
                            <Ionicons name="sparkles" size={14} color={COLORS.white} style={{ marginRight: 6 }} />
                            <Text style={styles.btnPrimaryText}>{uploading ? 'Processing...' : 'AI Import Bill'}</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Date + Search row on mobile */}
                    <View style={[styles.filterRow, r.isSmall && styles.filterRowMobile]}>
                        {/* Date Filter */}
                        <View style={[styles.dateFilterRow, r.isSmall && { minWidth: 0, maxWidth: 140 }]}>
                            <Ionicons name="calendar-outline" size={13} color={COLORS.textMuted} />
                            <input
                                type="date"
                                value={filterDate}
                                onChange={(e) => setFilterDate(e.target.value)}
                                style={{
                                    height: r.isSmall ? 34 : 28,
                                    width: r.isSmall ? 100 : undefined,
                                    maxWidth: r.isSmall ? 110 : undefined,
                                    fontSize: 11,
                                    fontFamily: 'Inter, sans-serif',
                                    color: '#4A5C58',
                                    backgroundColor: '#FFFFFF',
                                    border: '0.5px solid #CDD5D1',
                                    borderRadius: 2,
                                    paddingLeft: 6,
                                    paddingRight: 4,
                                    outline: 'none',
                                    cursor: 'pointer',
                                }}
                            />
                            {filterDate ? (
                                <TouchableOpacity
                                    onPress={() => setFilterDate('')}
                                    style={styles.dateClearBtn}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                    <Ionicons name="close-circle" size={14} color={COLORS.textMuted} />
                                </TouchableOpacity>
                            ) : null}
                        </View>

                        {/* Supplier Search */}
                        <View style={[styles.searchBox, r.isSmall && styles.searchBoxMobile, { minWidth: 0 }]}>
                            <Ionicons name="search-outline" size={14} color={COLORS.textMuted} />
                            <TextInput
                                style={styles.searchInput}
                                placeholder="Filter by supplier..."
                                placeholderTextColor={COLORS.textMuted}
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                            />
                            {searchQuery.length > 0 && (
                                <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                                    <Ionicons name="close-circle" size={14} color={COLORS.textMuted} />
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                </View>
            </View>

            {/* ─── UPLOAD INFO BANNER (only shown while uploading) ─── */}
            {uploading && (
                <View style={styles.uploadBanner}>
                    <ActivityIndicator size="small" color={COLORS.primary} style={{ marginRight: 8 }} />
                    <Text style={styles.uploadBannerText}>{uploadProgress || 'Processing…'}</Text>
                </View>
            )}

            {/* ─── CONTENT: Cards on mobile, Table on desktop ─── */}
            {r.isSmall ? (
                /* ─── MOBILE: Card List ─── */
                <View style={{ flex: 1 }}>
                    {loading ? (
                        <View style={styles.centerBox}>
                            <ActivityIndicator size="large" color={COLORS.primary} />
                            <Text style={styles.loadingText}>Loading purchases…</Text>
                        </View>
                    ) : filteredPurchases.length > 0 ? (
                        <FlatList
                            data={filteredPurchases}
                            keyExtractor={(item) => item._id}
                            renderItem={renderMobileCard}
                            showsVerticalScrollIndicator={false}
                            onRefresh={onRefresh}
                            refreshing={refreshing}
                            contentContainerStyle={{ paddingBottom: 20 }}
                        />
                    ) : (
                        <View style={styles.centerBox}>
                            <Ionicons name="receipt-outline" size={44} color={COLORS.border} />
                            <Text style={styles.emptyText}>No purchase records yet</Text>
                            <Text style={styles.emptySubText}>AI Imported bills from inventory will appear here.</Text>
                        </View>
                    )}
                </View>
            ) : (
                /* ─── DESKTOP: Table ─── */
                <View style={styles.tableContainer}>
                    {/* Table Header */}
                    <View style={styles.tableHeader}>
                        <View style={[styles.thCell, { width: 44, alignItems: 'center' }]}>
                            <Text style={styles.th}>#</Text>
                        </View>
                        <View style={[styles.thCell, { flex: 1.6 }]}>
                            <Text style={styles.th}>Date / Inv No</Text>
                        </View>
                        <View style={[styles.thCell, { flex: 1.8 }]}>
                            <Text style={styles.th}>Supplier / GSTIN</Text>
                        </View>
                        <View style={[styles.thCell, { flex: 0.8, alignItems: 'center' }]}>
                            <Text style={styles.th}>Items</Text>
                        </View>
                        <View style={[styles.thCell, { flex: 1.2, alignItems: 'center' }]}>
                            <Text style={styles.th}>Amount</Text>
                        </View>
                        <View style={[styles.thCell, { flex: 1.2, alignItems: 'center' }]}>
                            <Text style={styles.th}>Bill</Text>
                        </View>
                        <View style={[styles.thCell, { flex: 1, alignItems: 'center' }]}>
                            <Text style={styles.th}>Status</Text>
                        </View>
                        <View style={[styles.thCell, { flex: 0.8, alignItems: 'center', borderRightWidth: 0 }]}>
                            <Text style={styles.th}>Actions</Text>
                        </View>
                    </View>

                    {/* Table Body */}
                    {loading ? (
                        <View style={styles.centerBox}>
                            <ActivityIndicator size="large" color={COLORS.primary} />
                            <Text style={styles.loadingText}>Loading purchases…</Text>
                        </View>
                    ) : filteredPurchases.length > 0 ? (
                        <FlatList
                            data={filteredPurchases}
                            keyExtractor={(item) => item._id}
                            renderItem={renderRow}
                            showsVerticalScrollIndicator={false}
                            onRefresh={onRefresh}
                            refreshing={refreshing}
                        />
                    ) : (
                        <View style={styles.centerBox}>
                            <Ionicons name="receipt-outline" size={44} color={COLORS.border} />
                            <Text style={styles.emptyText}>No purchase records yet</Text>
                            <Text style={styles.emptySubText}>AI Imported bills from inventory will appear here.</Text>
                        </View>
                    )}
                </View>
            )}

            {/* ─── IMAGE PREVIEW MODAL ─── */}
            <ImagePreviewModal
                visible={previewVisible}
                imageUrl={previewUrl}
                onClose={() => { setPreviewVisible(false); setPreviewUrl(null); }}
            />

            {/* ─── DELETE CONFIRM MODAL ─── */}
            <Modal visible={deleteModalVisible} animationType="fade" transparent>
                <View style={styles.modalOverlay}>
                    <View style={[styles.deleteModal, r.isSmall && { width: '90%', maxWidth: 380 }]}>
                        <View style={styles.deleteIconBox}>
                            <Ionicons name="warning-outline" size={32} color={COLORS.error} />
                        </View>
                        <Text style={styles.deleteTitle}>Delete Purchase?</Text>
                        <Text style={styles.deleteDesc}>
                            This will remove the purchase record and its bill image reference. This cannot be undone.
                        </Text>
                        <View style={styles.deleteActions}>
                            <TouchableOpacity
                                style={[styles.btnSecondary, { flex: 1 }]}
                                onPress={() => { setDeleteModalVisible(false); setDeletingId(null); }}
                            >
                                <Text style={styles.btnSecondaryText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.btnDanger, { flex: 1 }]}
                                onPress={handleDelete}
                                disabled={deleteLoading}
                            >
                                {deleteLoading
                                    ? <ActivityIndicator size="small" color={COLORS.white} />
                                    : <>
                                        <Ionicons name="trash-outline" size={13} color={COLORS.white} style={{ marginRight: 4 }} />
                                        <Text style={styles.btnDangerText}>Delete</Text>
                                    </>
                                }
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ─── UNDER WORK MODAL FOR AI IMPORT BILL ─── */}
            <Modal visible={underWorkModalVisible} animationType="fade" transparent onRequestClose={() => setUnderWorkModalVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={[styles.deleteModal, r.isSmall && { width: '90%', maxWidth: 380 }]}>
                        <View style={[styles.deleteIconBox, { backgroundColor: COLORS.warningLight || 'rgba(184, 134, 11, 0.10)' }]}>
                            <Ionicons name="construct-outline" size={32} color={COLORS.warning || '#B8860B'} />
                        </View>
                        <Text style={styles.deleteTitle}>AI Import Bill</Text>
                        <Text style={[styles.deleteDesc, { textAlign: 'center', marginTop: 4, color: COLORS.textSecondary }]}>
                            This feature is under work, please keep patience.
                        </Text>
                        <View style={[styles.deleteActions, { marginTop: 8 }]}>
                            <TouchableOpacity
                                style={[styles.btnPrimary, { flex: 1, paddingVertical: 10, height: 38, alignItems: 'center', justifyContent: 'center' }]}
                                onPress={() => setUnderWorkModalVisible(false)}
                            >
                                <Text style={styles.btnPrimaryText}>Got it</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ─── AI IMPORT UPLOAD MODAL ─── */}
            <Modal visible={autoImportNoticeVisible} animationType="fade" transparent>
                <View style={styles.modalOverlay}>
                    <View style={[styles.uploadFormModal, r.isSmall && { width: '90%' }]}>
                        <View style={styles.uploadFormHeader}>
                            <View style={styles.uploadFormIconBox}>
                                <Ionicons name="sparkles" size={20} color={COLORS.primary} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.uploadFormTitle}>AI Bill Import</Text>
                                <Text style={styles.uploadFormSubtitle}>Optional hints to improve extraction accuracy.</Text>
                            </View>
                            <TouchableOpacity style={styles.uploadFormCloseBtn} onPress={() => setAutoImportNoticeVisible(false)}>
                                <Ionicons name="close" size={18} color={COLORS.textMuted} />
                            </TouchableOpacity>
                        </View>
                        <View style={styles.uploadFormBody}>
                            <View style={styles.formGroup}>
                                <Text style={styles.formLabel}>Supplier Name</Text>
                                <View style={styles.formInputRow}>
                                    <TextInput
                                        style={styles.formInput}
                                        placeholder="e.g. Apollo Pharmacy"
                                        placeholderTextColor={COLORS.textMuted}
                                        value={uploadHints.supplier_name}
                                        onChangeText={t => setUploadHints(h => ({ ...h, supplier_name: t }))}
                                    />
                                </View>
                            </View>
                            <View style={styles.formGroup}>
                                <Text style={styles.formLabel}>Bill Date</Text>
                                <View style={styles.formInputRow}>
                                    <TextInput
                                        style={styles.formInput}
                                        placeholder="YYYY-MM-DD"
                                        placeholderTextColor={COLORS.textMuted}
                                        value={uploadHints.bill_date}
                                        onChangeText={t => setUploadHints(h => ({ ...h, bill_date: t }))}
                                    />
                                </View>
                            </View>
                            <View style={styles.formGroup}>
                                <Text style={styles.formLabel}>Total Amount</Text>
                                <View style={styles.formInputRow}>
                                    <TextInput
                                        style={styles.formInput}
                                        placeholder="0.00"
                                        keyboardType="numeric"
                                        placeholderTextColor={COLORS.textMuted}
                                        value={uploadHints.total_amount}
                                        onChangeText={t => setUploadHints(h => ({ ...h, total_amount: t }))}
                                    />
                                </View>
                            </View>
                        </View>
                        <View style={styles.uploadFormFooter}>
                            <TouchableOpacity style={[styles.btnSecondary, { flex: 1 }]} onPress={() => setAutoImportNoticeVisible(false)}>
                                <Text style={styles.btnSecondaryText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={confirmUploadBill}>
                                <Ionicons name="image-outline" size={14} color={COLORS.white} style={{ marginRight: 6 }} />
                                <Text style={styles.btnPrimaryText}>Select Image</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ─── UPLOAD SUCCESS MODAL ─── */}
            <Modal visible={uploadSuccessModalVisible} animationType="fade" transparent>
                <View style={styles.modalOverlay}>
                    <View style={[styles.deleteModal, r.isSmall && { width: '90%', maxWidth: 380 }]}>
                        <View style={[styles.deleteIconBox, { backgroundColor: COLORS.successGhost }]}>
                            <Ionicons name="checkmark-circle-outline" size={32} color={COLORS.success} />
                        </View>
                        <Text style={styles.deleteTitle}>Upload Successful!</Text>
                        <Text style={[styles.deleteDesc, { textAlign: 'center' }]}>
                            Bill uploaded successfully. The processing is in progress and it can take up to a few hours. You can close this and continue billing.
                        </Text>
                        <View style={styles.deleteActions}>
                            <TouchableOpacity
                                style={[styles.btnPrimary, { flex: 1, paddingVertical: 12, alignItems: 'center' }]}
                                onPress={() => setUploadSuccessModalVisible(false)}
                            >
                                <Text style={styles.btnPrimaryText}>Got it</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ─── NEW PURCHASE DRAFT MODAL (STEP 1) ─── */}
            <Modal visible={draftModalVisible} animationType="fade" transparent onRequestClose={() => setDraftModalVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={[styles.uploadFormModal, { width: 480, maxWidth: '95%' }]}>
                        {/* Header */}
                        <View style={styles.uploadFormHeader}>
                            <View style={styles.uploadFormIconBox}>
                                <Ionicons name="document-text-outline" size={20} color={COLORS.primary} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.uploadFormTitle}>Add Purchase (Draft & Info)</Text>
                                <Text style={styles.uploadFormSubtitle}>Step 1: Upload bill image & basic details</Text>
                            </View>
                            <TouchableOpacity onPress={() => setDraftModalVisible(false)} style={styles.uploadFormCloseBtn}>
                                <Ionicons name="close" size={18} color={COLORS.textMuted} />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={styles.uploadFormBody}>
                            {/* Bill Image Upload Picker */}
                            <Text style={styles.formLabel}>Bill Image / Photo (Optional)</Text>
                            <TouchableOpacity
                                style={{
                                    borderWidth: 1.5,
                                    borderColor: draftSelectedFile ? COLORS.primary : COLORS.border,
                                    borderStyle: 'dashed',
                                    borderRadius: 8,
                                    padding: 16,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: draftSelectedFile ? COLORS.primaryGhost : COLORS.bgInput,
                                    marginBottom: 10
                                }}
                                onPress={handlePickDraftFile}
                            >
                                {draftSelectedFile ? (
                                    <View style={{ alignItems: 'center' }}>
                                        <Ionicons name="checkmark-circle" size={30} color={COLORS.primary} />
                                        <Text style={{ marginTop: 4, fontWeight: '600', color: COLORS.primary, fontSize: 13 }}>{draftSelectedFile.name}</Text>
                                        <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>Click to change photo</Text>
                                    </View>
                                ) : (
                                    <View style={{ alignItems: 'center' }}>
                                        <Ionicons name="camera-outline" size={30} color={COLORS.primary} />
                                        <Text style={{ marginTop: 4, fontWeight: '600', color: COLORS.textPrimary, fontSize: 13 }}>Take Photo or Choose Bill Image</Text>
                                        <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>Supported: JPG, PNG, HEIC (iPhone)</Text>
                                    </View>
                                )}
                            </TouchableOpacity>

                            {/* Supplier Name */}
                            <View style={styles.formGroup}>
                                <Text style={styles.formLabel}>Supplier Name</Text>
                                <View style={styles.formInputRow}>
                                    <TextInput
                                        style={styles.formInput}
                                        placeholder="Enter supplier name"
                                        placeholderTextColor={COLORS.textMuted}
                                        value={draftForm.supplier_name}
                                        onChangeText={(val) => setDraftForm(prev => ({ ...prev, supplier_name: val }))}
                                    />
                                </View>
                            </View>

                            {/* Bill Date */}
                            <View style={styles.formGroup}>
                                <Text style={styles.formLabel}>Bill Date</Text>
                                <View style={styles.formInputRow}>
                                    <TextInput
                                        style={styles.formInput}
                                        placeholder="YYYY-MM-DD"
                                        placeholderTextColor={COLORS.textMuted}
                                        value={draftForm.bill_date}
                                        onChangeText={(val) => setDraftForm(prev => ({ ...prev, bill_date: val }))}
                                    />
                                </View>
                            </View>

                            {/* Bill No / Invoice No */}
                            <View style={styles.formGroup}>
                                <Text style={styles.formLabel}>Invoice / Bill No.</Text>
                                <View style={styles.formInputRow}>
                                    <TextInput
                                        style={styles.formInput}
                                        placeholder="e.g. INV-90812"
                                        placeholderTextColor={COLORS.textMuted}
                                        value={draftForm.bill_no}
                                        onChangeText={(val) => setDraftForm(prev => ({ ...prev, bill_no: val }))}
                                    />
                                </View>
                            </View>

                            {/* Notes */}
                            <View style={styles.formGroup}>
                                <Text style={styles.formLabel}>Notes / Remarks</Text>
                                <View style={styles.formInputRow}>
                                    <TextInput
                                        style={styles.formInput}
                                        placeholder="Additional notes..."
                                        placeholderTextColor={COLORS.textMuted}
                                        value={draftForm.notes}
                                        onChangeText={(val) => setDraftForm(prev => ({ ...prev, notes: val }))}
                                    />
                                </View>
                            </View>
                        </ScrollView>

                        {/* Footer Actions */}
                        <View style={{ padding: 14, borderTopWidth: 0.5, borderTopColor: COLORS.border, flexDirection: 'row', gap: 10, justifyContent: 'flex-end', backgroundColor: '#F8FAF9' }}>
                            <TouchableOpacity
                                style={[styles.btnSecondary, { height: 36, paddingHorizontal: 12 }]}
                                onPress={handleDirectFullPurchase}
                            >
                                <Text style={[styles.btnSecondaryText, { color: COLORS.textPrimary }]}>Skip to Full Form</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.btnPrimary, { height: 36, paddingHorizontal: 18 }]}
                                onPress={handleSaveDraft}
                                disabled={draftLoading}
                            >
                                {draftLoading ? (
                                    <ActivityIndicator size="small" color={COLORS.white} />
                                ) : (
                                    <>
                                        <Ionicons name="cloud-upload-outline" size={15} color={COLORS.white} style={{ marginRight: 6 }} />
                                        <Text style={styles.btnPrimaryText}>Save Draft</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ─── MANUAL PURCHASE MODAL ─── */}
            <Modal visible={manualPurchaseModalVisible} transparent animationType="slide">
                <View style={formStyles.overlay}>
                    <View style={[formStyles.container, { width: '95%', maxWidth: 1000, maxHeight: '90%' }]}>
                        <View style={formStyles.header}>
                            <View>
                                <Text style={formStyles.title}>Manual Purchase Entry</Text>
                                <Text style={formStyles.subtitle}>Enter supplier and item details</Text>
                            </View>
                            <TouchableOpacity onPress={() => setManualPurchaseModalVisible(false)}>
                                <Ionicons name="close" size={24} color={COLORS.textMuted} />
                            </TouchableOpacity>
                        </View>
                        <ScrollView style={formStyles.body}>
                            {manualPurchaseForm.bill_image_url && (
                                <View style={{ backgroundColor: '#F0F9FF', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#BAE6FD', marginBottom: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                        <Ionicons name="image" size={20} color="#0284C7" />
                                        <View>
                                            <Text style={{ fontSize: 13, fontWeight: '600', color: '#0369A1' }}>Attached Bill Image Available</Text>
                                            <Text style={{ fontSize: 11, color: '#0284C7' }}>Click view to open full high-res bill photo</Text>
                                        </View>
                                    </View>
                                    <TouchableOpacity
                                        style={{ backgroundColor: '#0284C7', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 }}
                                        onPress={() => openPreview(manualPurchaseForm.bill_image_url)}
                                    >
                                        <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 12 }}>View Bill Image</Text>
                                    </TouchableOpacity>
                                </View>
                            )}
                            {/* Supplier Section */}
                            <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 10 }}>1. Supplier Info</Text>
                            <View style={{ flexDirection: r.isSmall ? 'column' : 'row', gap: 15, marginBottom: 20 }}>
                                <View style={{ flex: 1 }}>
                                    <Text style={formStyles.label}>Supplier Name <Text style={{ color: COLORS.error }}>*</Text></Text>
                                    <TextInput style={formStyles.input} placeholder="Supplier Name" value={manualPurchaseForm.supplier_name} onChangeText={(t) => setManualPurchaseForm({ ...manualPurchaseForm, supplier_name: t })} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={formStyles.label}>GST No.</Text>
                                    <TextInput style={formStyles.input} placeholder="GSTIN" value={manualPurchaseForm.supplier_gstin} onChangeText={(t) => setManualPurchaseForm({ ...manualPurchaseForm, supplier_gstin: t })} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={formStyles.label}>Invoice ID</Text>
                                    <TextInput style={formStyles.input} placeholder="Invoice ID" value={manualPurchaseForm.bill_no} onChangeText={(t) => setManualPurchaseForm({ ...manualPurchaseForm, bill_no: t })} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={formStyles.label}>Bill Date</Text>
                                    <TextInput style={formStyles.input} placeholder="YYYY-MM-DD" value={manualPurchaseForm.bill_date} onChangeText={(t) => setManualPurchaseForm({ ...manualPurchaseForm, bill_date: t })} />
                                </View>
                            </View>

                            {/* Items Section */}
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.textPrimary }}>2. Items Info</Text>
                                <TouchableOpacity onPress={addManualPurchaseItem} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0F9FF', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: '#BAE6FD' }}>
                                    <Ionicons name="add" size={14} color="#0284C7" style={{ marginRight: 4 }} />
                                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#0284C7' }}>Add Row</Text>
                                </TouchableOpacity>
                            </View>

                            {manualPurchaseForm.items.length === 0 ? (
                                <View style={{ padding: 20, alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', borderStyle: 'dashed', marginBottom: 20 }}>
                                    <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>No items added. Click "Add Row" to start.</Text>
                                </View>
                            ) : (
                                <View style={{ gap: 10, marginBottom: 20 }}>
                                    {manualPurchaseForm.items.map((item, idx) => (
                                        <View key={idx} style={{ backgroundColor: '#F8FAFC', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0' }}>
                                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                                                <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary }}>Item #{idx + 1}</Text>
                                                <TouchableOpacity onPress={() => removeManualPurchaseItem(idx)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                                                    <Ionicons name="trash-outline" size={16} color={COLORS.error} />
                                                </TouchableOpacity>
                                            </View>
                                            <View style={{ flexDirection: r.isSmall ? 'column' : 'row', gap: 10, flexWrap: 'wrap' }}>
                                                <View style={{ flex: 2, minWidth: 140 }}>
                                                    <Text style={formStyles.label}>Product Name <Text style={{ color: COLORS.error }}>*</Text></Text>
                                                    <TextInput style={formStyles.input} placeholder="Product Name" value={item.medicine_name} onChangeText={(t) => handleManualPurchaseItemChange(idx, 'medicine_name', t)} />
                                                </View>
                                                <View style={{ flex: 1, minWidth: 60 }}>
                                                    <Text style={formStyles.label}>MRP</Text>
                                                    <TextInput style={formStyles.input} keyboardType="numeric" placeholder="0.00" value={item.mrp} onChangeText={(t) => handleManualPurchaseItemChange(idx, 'mrp', t)} />
                                                </View>
                                                <View style={{ flex: 1, minWidth: 60 }}>
                                                    <Text style={formStyles.label}>Rate</Text>
                                                    <TextInput style={formStyles.input} keyboardType="numeric" placeholder="0.00" value={item.rate} onChangeText={(t) => handleManualPurchaseItemChange(idx, 'rate', t)} />
                                                </View>
                                                <View style={{ flex: 1, minWidth: 50 }}>
                                                    <Text style={formStyles.label}>Disc %</Text>
                                                    <TextInput style={formStyles.input} keyboardType="numeric" placeholder="0" value={item.discount} onChangeText={(t) => handleManualPurchaseItemChange(idx, 'discount', t)} />
                                                </View>
                                                <View style={{ flex: 1, minWidth: 50 }}>
                                                    <Text style={formStyles.label}>Qty</Text>
                                                    <TextInput style={formStyles.input} keyboardType="numeric" placeholder="0" value={item.quantity} onChangeText={(t) => handleManualPurchaseItemChange(idx, 'quantity', t)} />
                                                </View>
                                                <View style={{ flex: 1.5, minWidth: 80 }}>
                                                    <Text style={formStyles.label}>Batch</Text>
                                                    <TextInput style={formStyles.input} placeholder="Batch" value={item.batch_number} onChangeText={(t) => handleManualPurchaseItemChange(idx, 'batch_number', t)} />
                                                </View>
                                                <View style={{ flex: 1, minWidth: 60 }}>
                                                    <Text style={formStyles.label}>Expiry</Text>
                                                    <TextInput style={formStyles.input} placeholder="MM/YY" value={item.expiry_date} onChangeText={(t) => handleManualPurchaseItemChange(idx, 'expiry_date', t)} />
                                                </View>
                                                <View style={{ flex: 1, minWidth: 60 }}>
                                                    <Text style={formStyles.label}>HSN</Text>
                                                    <TextInput style={formStyles.input} placeholder="HSN" value={item.hsn_code} onChangeText={(t) => handleManualPurchaseItemChange(idx, 'hsn_code', t)} />
                                                </View>
                                                <View style={{ flex: 1, minWidth: 50 }}>
                                                    <Text style={formStyles.label}>GST %</Text>
                                                    <TextInput style={formStyles.input} keyboardType="numeric" placeholder="0" value={item.gst} onChangeText={(t) => handleManualPurchaseItemChange(idx, 'gst', t)} />
                                                </View>
                                            </View>
                                        </View>
                                    ))}
                                </View>
                            )}

                            {/* Tax Details Section */}
                            <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 10 }}>3. Tax & Totals</Text>
                            <View style={{ flexDirection: r.isSmall ? 'column' : 'row', gap: 15, backgroundColor: '#F0FDFA', padding: 15, borderRadius: 8, borderWidth: 1, borderColor: '#CCFBF1' }}>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4 }}>Taxable Amount</Text>
                                    <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.textPrimary }}>₹{manualPurchaseForm.taxable_amount.toFixed(2)}</Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4 }}>Total CGST</Text>
                                    <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.textPrimary }}>₹{manualPurchaseForm.cgst_amount.toFixed(2)}</Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4 }}>Total SGST</Text>
                                    <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.textPrimary }}>₹{manualPurchaseForm.sgst_amount.toFixed(2)}</Text>
                                </View>
                                <View style={{ flex: 1, backgroundColor: '#FFFFFF', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 6, elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2 }}>
                                    <Text style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4 }}>Total Amount</Text>
                                    <Text style={{ fontSize: 18, fontWeight: '800', color: '#0F766E' }}>₹{manualPurchaseForm.total_amount.toFixed(2)}</Text>
                                </View>
                            </View>

                        </ScrollView>
                        <View style={formStyles.footer}>
                            <TouchableOpacity style={formStyles.cancelBtn} onPress={() => setManualPurchaseModalVisible(false)} disabled={manualPurchaseLoading}>
                                <Text style={formStyles.cancelBtnText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={formStyles.saveBtn} onPress={handleSaveManualPurchase} disabled={manualPurchaseLoading}>
                                {manualPurchaseLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={formStyles.saveBtnText}>Save Purchase</Text>}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ─── REVIEW AUTO IMPORT MODAL ─── */}
            <Modal visible={reviewModalVisible} transparent animationType="slide">
                <View style={formStyles.overlay}>
                    <View style={[formStyles.container, { width: '95%', maxWidth: 1000, maxHeight: '90%' }]}>
                        <View style={formStyles.header}>
                            <View>
                                <Text style={formStyles.title}>Review Auto-Imported Purchase</Text>
                                <Text style={formStyles.subtitle}>Supplier: {reviewMetadata.supplier_name || 'N/A'} | Total: ₹{reviewMetadata.total_amount || '0.00'}</Text>
                            </View>
                            <TouchableOpacity onPress={() => {
                                setReviewModalVisible(false);
                                setReviewPurchaseId(null);
                                setReviewItems([]);
                            }}>
                                <Ionicons name="close" size={24} color={COLORS.textMuted} />
                            </TouchableOpacity>
                        </View>
                        <ScrollView style={formStyles.body}>
                            {reviewItems.length === 0 ? (
                                <View style={{ padding: 20, alignItems: 'center' }}>
                                    <Text style={{ color: COLORS.textMuted }}>No items extracted to review.</Text>
                                </View>
                            ) : (
                                <View style={{ gap: 10, marginBottom: 20 }}>
                                    {reviewItems.map((item, idx) => (
                                        <View key={idx} style={{ backgroundColor: '#F8FAFC', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0' }}>
                                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                                                <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary }}>Item #{idx + 1}</Text>
                                                <TouchableOpacity onPress={() => handleReviewItemDelete(idx)}>
                                                    <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                                                </TouchableOpacity>
                                            </View>
                                            <View style={{ flexDirection: r.isSmall ? 'column' : 'row', gap: 10, flexWrap: 'wrap' }}>
                                                <View style={{ flex: 2, minWidth: 140 }}>
                                                    <Text style={formStyles.label}>Product Name</Text>
                                                    <TextInput style={formStyles.input} placeholder="Product Name" value={item.medicine_name || item.product_name} onChangeText={(t) => handleReviewItemChange(idx, 'medicine_name', t)} />
                                                </View>
                                                <View style={{ flex: 1, minWidth: 60 }}>
                                                    <Text style={formStyles.label}>MRP</Text>
                                                    <TextInput style={formStyles.input} keyboardType="numeric" placeholder="0.00" value={String(item.mrp || '')} onChangeText={(t) => handleReviewItemChange(idx, 'mrp', t)} />
                                                </View>
                                                <View style={{ flex: 1, minWidth: 50 }}>
                                                    <Text style={formStyles.label}>Qty</Text>
                                                    <TextInput style={formStyles.input} keyboardType="numeric" placeholder="0" value={String(item.quantity || '')} onChangeText={(t) => handleReviewItemChange(idx, 'quantity', t)} />
                                                </View>
                                                <View style={{ flex: 1.5, minWidth: 80 }}>
                                                    <Text style={formStyles.label}>Batch</Text>
                                                    <TextInput style={formStyles.input} placeholder="Batch" value={item.batch_number || ''} onChangeText={(t) => handleReviewItemChange(idx, 'batch_number', t)} />
                                                </View>
                                                <View style={{ flex: 1, minWidth: 60 }}>
                                                    <Text style={formStyles.label}>Expiry</Text>
                                                    <TextInput style={formStyles.input} placeholder="YYYY-MM" value={item.expiry_date || ''} onChangeText={(t) => handleReviewItemChange(idx, 'expiry_date', t)} />
                                                </View>
                                                <View style={{ flex: 1, minWidth: 60 }}>
                                                    <Text style={formStyles.label}>HSN</Text>
                                                    <TextInput style={formStyles.input} placeholder="HSN" value={item.hsn_code || ''} onChangeText={(t) => handleReviewItemChange(idx, 'hsn_code', t)} />
                                                </View>
                                                <View style={{ flex: 1, minWidth: 60 }}>
                                                    <Text style={formStyles.label}>GST %</Text>
                                                    <TextInput style={formStyles.input} keyboardType="numeric" placeholder="0" value={String(item.gst || '')} onChangeText={(t) => handleReviewItemChange(idx, 'gst', t)} />
                                                </View>
                                            </View>
                                        </View>
                                    ))}
                                </View>
                            )}
                        </ScrollView>
                        <View style={formStyles.footer}>
                            <TouchableOpacity 
                                style={formStyles.cancelBtn} 
                                onPress={() => {
                                    setReviewModalVisible(false);
                                    setReviewPurchaseId(null);
                                    setReviewItems([]);
                                }} 
                                disabled={reviewLoading}
                            >
                                <Text style={formStyles.cancelBtnText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={formStyles.saveBtn} onPress={handleReviewConfirm} disabled={reviewLoading}>
                                {reviewLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={formStyles.saveBtnText}>Confirm Import</Text>}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const formStyles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
    container: { backgroundColor: '#fff', borderRadius: 0, padding: 12, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 2, display: 'flex', flexDirection: 'column' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
    title: { fontSize: 15, fontWeight: '700', color: '#0F172A', textTransform: 'uppercase' },
    subtitle: { fontSize: 11, color: '#64748B', marginTop: 2 },
    body: { flex: 1 },
    label: { fontSize: 10, fontWeight: '600', color: '#475569', marginBottom: 4, textTransform: 'uppercase' },
    input: { height: 28, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 0, paddingHorizontal: 6, backgroundColor: '#FFFFFF', fontSize: 12, color: '#0F172A', outlineStyle: 'none' },
    inputFocus: { borderColor: '#2563EB', backgroundColor: '#F0F9FF' },
    footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#E2E8F0', marginTop: 10 },
    cancelBtn: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 0, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#CBD5E1' },
    cancelBtnText: { color: '#475569', fontSize: 12, fontWeight: '600' },
    saveBtn: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 0, backgroundColor: '#0F766E', justifyContent: 'center', alignItems: 'center', minWidth: 120 },
    saveBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
    tableHeader: { backgroundColor: '#F1F5F9', borderBottomWidth: 1, borderBottomColor: '#CBD5E1', paddingVertical: 6, paddingHorizontal: 4 },
    tableHeaderText: { fontSize: 10, fontWeight: '700', color: '#334155', textTransform: 'uppercase' },
    tableCell: { paddingHorizontal: 2, paddingVertical: 2, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', borderRightWidth: 1, borderRightColor: '#E2E8F0' },
    tableRow: { flexDirection: 'row', backgroundColor: '#FFFFFF' },
    tableRowHover: { backgroundColor: '#F8FAFC' }
});

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.bgDark,
        padding: 12,
    },

    // Header
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: 10,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
        marginBottom: 10,
    },
    headerMobile: {
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 10,
    },
    headerTitle: { fontSize: 16, fontWeight: '400', color: COLORS.textPrimary },
    headerSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    headerActionsMobile: {
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 8,
    },

    // Filter row (date + search together)
    filterRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    filterRowMobile: {
        flexDirection: 'row',
        gap: 8,
    },

    // Date Filter
    dateFilterRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    dateFilterLabel: {
        fontSize: 11,
        fontWeight: '500',
        color: COLORS.textMuted,
    },
    dateClearBtn: {
        marginLeft: 2,
    },

    // Search Box
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.white,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        borderRadius: 4,
        paddingHorizontal: 8,
        height: 32,
        width: 200,
    },
    searchBoxMobile: {
        flex: 1,
        width: undefined,
        height: 34,
    },
    searchInput: {
        flex: 1,
        height: '100%',
        marginLeft: 6,
        fontSize: 12,
        color: COLORS.textPrimary,
        outlineStyle: 'none',
    },

    // Upload Banner
    uploadBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.primaryGhost,
        borderWidth: 0.5,
        borderColor: COLORS.primarySoft,
        borderRadius: 2,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 10,
    },
    uploadBannerText: { fontSize: 12, color: COLORS.primary, fontWeight: '500' },

    // ─── MOBILE CARD STYLES ──────────────────────────────────────────────
    mobileCard: {
        backgroundColor: COLORS.white,
        borderRadius: 6,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        marginBottom: 10,
        overflow: 'hidden',
        maxWidth: '100%',
    },
    mobileCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
        backgroundColor: '#F8FAF9',
    },
    mobileCardSupplier: {
        fontSize: 13,
        fontWeight: '600',
        color: COLORS.textPrimary,
    },
    mobileCardGstin: {
        fontSize: 10,
        color: COLORS.textMuted,
        marginTop: 2,
    },
    mobileCardBody: {
        padding: 12,
        gap: 8,
    },
    mobileDetailRow: {
        flexDirection: 'row',
        gap: 12,
    },
    mobileDetailItem: {
        flex: 1,
    },
    mobileDetailLabel: {
        fontSize: 10,
        fontWeight: '500',
        color: COLORS.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
        marginBottom: 2,
    },
    mobileDetailValue: {
        fontSize: 12,
        color: COLORS.textSecondary,
    },
    mobileCardFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderTopWidth: 0.5,
        borderTopColor: COLORS.border,
        backgroundColor: '#FAFBFA',
    },

    // ─── DESKTOP TABLE STYLES ────────────────────────────────────────────
    tableContainer: {
        flex: 1,
        backgroundColor: COLORS.white,
        borderRadius: 2,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        overflow: 'hidden',
    },
    tableHeader: {
        flexDirection: 'row',
        alignItems: 'stretch',
        backgroundColor: '#EFF2F1',
        height: 34,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
    },
    thCell: {
        justifyContent: 'center',
        paddingHorizontal: 10,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.border,
        height: '100%',
    },
    th: {
        fontSize: 10,
        fontWeight: '500',
        color: COLORS.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    tableRow: {
        flexDirection: 'row',
        alignItems: 'stretch',
        height: 46,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
    },
    tableRowAlt: { backgroundColor: '#F8FAF9' },
    cell: {
        justifyContent: 'center',
        paddingHorizontal: 10,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.border,
        height: '100%',
    },
    cellText: { fontSize: 12, color: COLORS.textSecondary },
    cellMuted: { fontSize: 10, color: COLORS.textMuted, marginTop: 2 },

    // Bill badge
    viewBillBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        height: 24,
        borderRadius: 2,
        borderWidth: 0.5,
        borderColor: COLORS.primary,
        backgroundColor: COLORS.primaryGhost,
    },
    viewBillText: { fontSize: 11, fontWeight: '600', color: COLORS.primary },
    noBillBadge: {
        paddingHorizontal: 8,
        height: 22,
        borderRadius: 2,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        backgroundColor: COLORS.bgSurface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    noBillText: { fontSize: 10, color: COLORS.textMuted, fontWeight: '500' },

    // Status badge
    statusBadge: {
        paddingHorizontal: 7,
        height: 20,
        borderRadius: 2,
        borderWidth: 0.5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    statusText: { fontSize: 9, fontWeight: '600', letterSpacing: 0.4 },
    status_processing: { backgroundColor: '#E0F2FE', borderColor: '#0284C7' },
    statusText_processing: { color: '#0284C7' },
    status_failed: { backgroundColor: '#FEE2E2', borderColor: '#DC2626' },
    statusText_failed: { color: '#DC2626' },
    status_pending: { backgroundColor: COLORS.warningLight, borderColor: COLORS.warning },
    statusText_pending: { color: COLORS.warning },
    status_received: { backgroundColor: COLORS.successLight, borderColor: COLORS.primary },
    statusText_received: { color: COLORS.primary },
    status_cancelled: { backgroundColor: COLORS.errorLight, borderColor: COLORS.error },
    statusText_cancelled: { color: COLORS.error },

    // Action buttons
    actionBtn: {
        width: 28,
        height: 28,
        borderRadius: 2,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        backgroundColor: COLORS.white,
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionBtnDanger: { backgroundColor: COLORS.errorLight, borderColor: COLORS.error },

    // Empty / Loading
    centerBox: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        gap: 6,
        opacity: 0.3,
    },
    loadingText: { fontSize: 12, color: COLORS.textMuted, marginTop: 8 },
    emptyText: { fontSize: 14, color: COLORS.textMuted, fontWeight: '500', marginTop: 4 },
    emptySubText: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center' },

    // Buttons
    btnPrimary: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 2,
        backgroundColor: COLORS.primary,
        borderWidth: 0.5,
        borderColor: COLORS.primary,
    },
    btnPrimaryText: { fontSize: 12, fontWeight: '600', color: COLORS.white },
    btnSecondary: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 2,
        backgroundColor: COLORS.white,
        borderWidth: 0.5,
        borderColor: COLORS.border,
    },
    btnSecondaryText: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },
    btnDanger: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 2,
        backgroundColor: COLORS.error,
        borderWidth: 0.5,
        borderColor: COLORS.error,
    },
    btnDangerText: { fontSize: 12, fontWeight: '600', color: COLORS.white },

    // Modals
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.35)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    deleteModal: {
        width: 380,
        backgroundColor: COLORS.white,
        borderRadius: 2,
        padding: 20,
        alignItems: 'center',
        borderWidth: 0.5,
        borderColor: COLORS.border,
    },
    deleteIconBox: {
        width: 52,
        height: 52,
        borderRadius: 2,
        backgroundColor: COLORS.errorLight,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
    },
    deleteTitle: { fontSize: 15, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 6 },
    deleteDesc: {
        fontSize: 12,
        color: COLORS.textMuted,
        textAlign: 'center',
        lineHeight: 18,
        marginBottom: 16,
    },
    deleteActions: { flexDirection: 'row', gap: 8, width: '100%' },

    // ─── Upload Form Modal ────────────────────────────────────────────
    uploadFormModal: {
        width: 420,
        backgroundColor: COLORS.white,
        borderRadius: 6,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        overflow: 'hidden',
    },
    uploadFormHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
        backgroundColor: '#F8FAF9',
        gap: 10,
    },
    uploadFormIconBox: {
        width: 40,
        height: 40,
        borderRadius: 8,
        backgroundColor: COLORS.primaryGhost,
        alignItems: 'center',
        justifyContent: 'center',
    },
    uploadFormTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: COLORS.textPrimary,
    },
    uploadFormSubtitle: {
        fontSize: 11,
        color: COLORS.textMuted,
        marginTop: 1,
    },
    uploadFormCloseBtn: {
        width: 28,
        height: 28,
        borderRadius: 4,
        backgroundColor: COLORS.bgDark,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        alignItems: 'center',
        justifyContent: 'center',
    },
    uploadFormBody: {
        padding: 16,
        gap: 14,
    },
    formGroup: {
        gap: 5,
    },
    formLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: COLORS.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
    },
    formInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.white,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        borderRadius: 4,
        paddingHorizontal: 10,
        height: 38,
    },
    formInput: {
        flex: 1,
        height: '100%',
        fontSize: 13,
        color: COLORS.textPrimary,
        outlineStyle: 'none',
    },
    uploadFormFooter: {
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderTopWidth: 0.5,
        borderTopColor: COLORS.border,
        backgroundColor: '#F8FAF9',
    },
});
