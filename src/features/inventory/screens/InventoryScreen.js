import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
    View,
    Text,
    FlatList,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    Modal,
    ScrollView,
    ActivityIndicator,
    Alert,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT_SIZES, RADIUS, SPACING, SHADOWS } from '../../../core/constants/theme';
import GradientButton from '../../../core/components/GradientButton';
import FlappyBird from '../../bored/components/FlappyBird';
import Skeleton from '../../../core/components/Skeleton';
import {
    getProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    autoImportBill,
    confirmAutoImport,
} from '../services/inventoryService';
import { finalizePurchase, getPurchases } from '../../purchase/services/purchaseService';
import { printLabels58mm } from '../../../core/utils/printLabel';
import { useResponsive } from '../../../core/utils/responsive';
import DateTimePicker from '@react-native-community/datetimepicker';
import { DocScanner } from '../../../core/utils/cvUtils';
import imageCompression from 'browser-image-compression';


// ─── FILTER TABS ────────────────────────────────
const FILTERS = [
    { key: 'all', label: 'All products', icon: 'cube-outline' },
    { key: 'dead_stock', label: 'Dead stock', icon: 'archive-outline' },
    { key: 'expiring_soon', label: 'Expiring soon', icon: 'time-outline' },
    { key: 'expired', label: 'Expired', icon: 'skull-outline' },
];

// ─── EMPTY PRODUCT FORM ────────────────────────
const EMPTY_FORM = {
    medicine_name: '',
    mrp: '',
    cost_price: '',
    quantity: '',
    alert_threshold: '',
    expiry_date: '',
    supplier_name: '',
    description: '',
    tablets_per_strip: '',
    batch_number: '',
    hsn_code: '',
    gst: '',
};

// ─── FORM FIELD COMPONENT ───────────────────────
const FormField = ({ label, value, onChangeText, placeholder, keyboardType, multiline, required, editable = true }) => (
    <View style={styles.fieldContainer}>
        <Text style={styles.fieldLabel}>
            {label}
            {required && <Text style={{ color: COLORS.error }}> *</Text>}
        </Text>
        <TextInput
            style={[
                styles.fieldInput,
                multiline && styles.fieldInputMultiline,
                !editable && styles.fieldInputDisabled,
            ]}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={COLORS.textMuted}
            keyboardType={keyboardType || "default"}
            multiline={multiline}
            editable={editable}
        />
    </View>
);

// ─── DATE FIELD COMPONENT ───────────────────────
const DateField = ({ label, value, onChangeDate, required, editable = true }) => {
    const [show, setShow] = useState(false);

    const dateValue = value ? new Date(value) : new Date();

    const onChange = (event, selectedDate) => {
        if (Platform.OS !== 'ios') {
            setShow(false);
        }
        if (selectedDate) {
            // Using local time to prevent timezone shift issues
            const dateStr = [
                selectedDate.getFullYear(),
                String(selectedDate.getMonth() + 1).padStart(2, '0'),
                String(selectedDate.getDate()).padStart(2, '0')
            ].join('-');
            onChangeDate(dateStr);
        }
    };

    if (Platform.OS === 'web') {
        const inputStyle = {
            flex: 1,
            backgroundColor: 'transparent',
            border: 'none',
            outline: 'none',
            fontSize: 14,
            color: COLORS.textPrimary,
            fontFamily: 'inherit',
            cursor: editable ? 'pointer' : 'not-allowed',
        };
        // Need to use createElement to avoid TS/JSX strict issues on native bundles if they parse it
        return (
            <View style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>
                    {label}
                    {required && <Text style={{ color: COLORS.error }}> *</Text>}
                </Text>
                <View style={[styles.fieldInput, !editable && styles.fieldInputDisabled, { flexDirection: 'row', alignItems: 'center' }]}>
                    {React.createElement('input', {
                        type: 'date',
                        value: value,
                        onChange: (e) => onChangeDate(e.target.value),
                        disabled: !editable,
                        style: inputStyle,
                    })}
                </View>
            </View>
        );
    }

    return (
        <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>
                {label}
                {required && <Text style={{ color: COLORS.error }}> *</Text>}
            </Text>
            <TouchableOpacity
                style={[styles.fieldInput, !editable && styles.fieldInputDisabled, { justifyContent: 'center' }]}
                onPress={() => editable && setShow(true)}
                activeOpacity={editable ? 0.7 : 1}
            >
                <Text style={{ color: value ? COLORS.textPrimary : COLORS.textMuted }}>
                    {value || "YYYY-MM-DD"}
                </Text>
            </TouchableOpacity>

            {show && (
                <DateTimePicker
                    value={dateValue}
                    mode="date"
                    display="default"
                    onChange={onChange}
                />
            )}
        </View>
    );
};

export default function InventoryScreen({ navigation, route }) {
    const r = useResponsive();
    // Data
    const [products, setProducts] = useState([]);
    const [filteredProducts, setFilteredProducts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    // Filters & Search
    const [activeFilter, setActiveFilter] = useState(route?.params?.filter || 'all');
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (route?.params?.filter) {
            setActiveFilter(route.params.filter);
        }
    }, [route?.params?.filter]);

    // Modal
    const [devModalVisible, setDevModalVisible] = useState(false);
    const [autoImportNoticeVisible, setAutoImportNoticeVisible] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [modalMode, setModalMode] = useState('add'); // 'add' | 'edit' | 'view'
    const [formError, setFormError] = useState('');
    const [formData, setFormData] = useState(EMPTY_FORM);
    const [editingId, setEditingId] = useState(null);
    const [saving, setSaving] = useState(false);

    // Label printing modal
    const [labelModalVisible, setLabelModalVisible] = useState(false);
    const [labelSearch, setLabelSearch] = useState('');
    const [labelLetter, setLabelLetter] = useState('All');
    const [labelLetterDropdown, setLabelLetterDropdown] = useState(false);
    const [labelItems, setLabelItems] = useState({}); // { [productId]: copies }
    const [generatingLabels, setGeneratingLabels] = useState(false);

    // Delete confirm
    const [deleteModalVisible, setDeleteModalVisible] = useState(false);
    const [deletingProduct, setDeletingProduct] = useState(null);
    const [deleting, setDeleting] = useState(false);

    // Return confirm
    const [returnModalVisible, setReturnModalVisible] = useState(false);
    const [returningProduct, setReturningProduct] = useState(null);
    const [returningLoading, setReturningLoading] = useState(false);

    // ─── RECENT BILLS STATE ───────────────────────
    const [recentBills, setRecentBills] = useState([]);
    const [recentBillsModalVisible, setRecentBillsModalVisible] = useState(false);
    const [recentBillsLoading, setRecentBillsLoading] = useState(false);

    // ─── AUTO IMPORT STATE ────────────────────────
    const [autoImportUploading, setAutoImportUploading] = useState(false);
    const [currentFactIndex, setCurrentFactIndex] = useState(0);
    const [autoImportReviewVisible, setAutoImportReviewVisible] = useState(false);
    const [autoImportItems, setAutoImportItems] = useState([]);
    const [autoImportConfirming, setAutoImportConfirming] = useState(false);
    const [autoImportError, setAutoImportError] = useState('');
    const [autoImportBillNo, setAutoImportBillNo] = useState('');
    const [autoImportBillDate, setAutoImportBillDate] = useState(''); // in-app error (web-safe)
    const [autoImportPurchaseId, setAutoImportPurchaseId] = useState(null); // purchase record id from Cloudinary upload
    const [toastVisible, setToastVisible] = useState(false);
    const [toastMessage, setToastMessage] = useState('');

    //  BATCH CONFLICT STATE 
    const [batchConflicts, setBatchConflicts] = useState([]);
    const [conflictModalVisible, setConflictModalVisible] = useState(false);
    const [pendingFinalizeItems, setPendingFinalizeItems] = useState([]);

    const finalizePurchaseCall = async (itemsToFinalize) => {
        if (!autoImportPurchaseId) return;
        try {
            const supplierName = itemsToFinalize.find(i => i.supplier_name?.trim())?.supplier_name?.trim() || '';
            const totalAmount  = itemsToFinalize.reduce((sum, i) => {
                const qty = Number(i.quantity) || 0;
                const cp  = Number(i.cost_price) || Number(i.mrp) || 0;
                return sum + qty * cp;
            }, 0);

            await finalizePurchase(autoImportPurchaseId, {
                supplier_name: supplierName,
                total_amount:  Math.round(totalAmount * 100) / 100,
                items_count:   itemsToFinalize.length,
                imported_items: itemsToFinalize.map(i => ({
                    inventoryId: i.inventoryId,
                    quantity: i.quantity,
                    mrp: i.mrp
                }))
            });
        } catch (finalizeErr) {
            console.warn('[AutoImport] finalizePurchase failed (non-fatal):', finalizeErr?.message);
        } finally {
            setAutoImportPurchaseId(null);
            setPendingFinalizeItems([]);
        }
    };

    const resolveConflict = async (resolutionType) => {
        const currentConflict = batchConflicts[0];
        if (!currentConflict) return;

        try {
            let payload = { ...currentConflict.payload };
            if (resolutionType === 'force_update') {
                payload.force_update = true;
            } else if (resolutionType === 'isolate') {
                const baseBatch = payload.batch_number || 'BATCH';
                payload.batch_number = `${baseBatch}-${Math.floor(Math.random() * 1000)}`;
            }

            const res = await createProduct(payload);
            const productData = res?.data?.data || res?.data || res;
            
            let updatedFinalizeItems = [...pendingFinalizeItems];
            
            if (currentConflict.source === 'auto_import' && currentConflict.originalKey) {
                setAutoImportItems(prev => prev.filter(i => i._key !== currentConflict.originalKey));
                
                if (productData?._id && currentConflict.originalItem) {
                    updatedFinalizeItems.push({
                        inventoryId: productData._id,
                        quantity: Number(currentConflict.originalItem.quantity) || 0,
                        mrp: Number(currentConflict.originalItem.mrp) || 0,
                        cost_price: Number(currentConflict.originalItem.cost_price) || Number(currentConflict.originalItem.mrp) || 0,
                        supplier_name: currentConflict.originalItem.supplier_name || ''
                    });
                    setPendingFinalizeItems(updatedFinalizeItems);
                }
            } else if (currentConflict.source === 'manual') {
                closeModal();
            }

            await fetchProducts();

            const remaining = batchConflicts.slice(1);
            setBatchConflicts(remaining);
            if (remaining.length === 0) {
                setConflictModalVisible(false);
                if (currentConflict.source === 'auto_import') {
                    if (autoImportReviewVisible) {
                        setAutoImportItems(prev => {
                            if (prev.length === 0) {
                                setAutoImportReviewVisible(false);
                            }
                            return prev;
                        });
                    }
                    if (autoImportPurchaseId) {
                        await finalizePurchaseCall(updatedFinalizeItems);
                    }
                }
            }
        } catch (err) {
            Alert.alert('Resolution Failed', err.message || 'Could not resolve conflict');
        }
    };

    // ─── FETCH ──────────────────────────────────────
    const fetchProducts = useCallback(async () => {
        setLoading(true);
        try {
            const response = await getProducts();
            const list = response?.data ?? response?.products ?? response ?? [];
            setProducts(Array.isArray(list) ? list : []);
        } catch (err) {
            console.log('Failed to fetch products:', err.message);
            setProducts([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            fetchProducts();
        }, [fetchProducts])
    );

    // ─── FILTER & SEARCH ────────────────────────────
    useEffect(() => {
        let result = [...products];

        // Apply filter
        if (activeFilter === 'dead_stock') {
            const threeMonthsAgo = new Date();
            threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
            result = result.filter((p) => {
                const qty = p.quantity ?? p.stock ?? 0;
                if (qty <= 0) return false;
                if (!p.createdAt) return false;
                return new Date(p.createdAt) < threeMonthsAgo;
            });
        } else if (activeFilter === 'expiring_soon') {
            const now = new Date();
            const threeMonths = new Date();
            threeMonths.setMonth(threeMonths.getMonth() + 3);
            result = result.filter((p) => {
                if (p.returned_to_supplier) return false;
                if (!p.expiry_date) return false;
                const exp = new Date(p.expiry_date);
                return exp >= now && exp <= threeMonths;
            });
        } else if (activeFilter === 'expired') {
            const now = new Date();
            result = result.filter((p) => {
                if (p.returned_to_supplier) return false;
                if (!p.expiry_date) return false;
                return new Date(p.expiry_date) < now;
            });
        }

        // Apply search
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(
                (p) =>
                    (p.medicine_name || '').toLowerCase().includes(q) ||
                    (p.supplier_name || '').toLowerCase().includes(q)
            );
        }

        setFilteredProducts(result);
    }, [products, activeFilter, searchQuery]);

    const onRefresh = async () => {
        setRefreshing(true);
        await fetchProducts();
        setRefreshing(false);
    };

    // ─── MODAL HANDLERS ─────────────────────────────
    const openAddModal = () => {
        setFormData(EMPTY_FORM);
        setEditingId(null);
        setModalMode('add');
        setModalVisible(true);
    };

    const openEditModal = (product) => {
        setFormData({
            medicine_name: product.medicine_name || '',
            mrp: String(product.mrp ?? ''),
            cost_price: String(product.cost_price ?? ''),
            quantity: String(product.quantity ?? ''),
            alert_threshold: String(product.alert_threshold ?? ''),
            expiry_date: product.expiry_date
                ? product.expiry_date.split('T')[0]
                : '',
            supplier_name: product.supplier_name || '',
            description: product.description || '',
            tablets_per_strip: product.tablets_per_strip ? String(product.tablets_per_strip) : '',
            batch_number: product.batch_number || '',
            hsn_code: product.hsn_code || '',
            gst: String(product.gst ?? ''),
        });
        setEditingId(product._id || product.id);
        setModalMode('edit');
        setModalVisible(true);
    };

    const openViewModal = (product) => {
        setFormData({
            medicine_name: product.medicine_name || '',
            mrp: String(product.mrp ?? ''),
            cost_price: String(product.cost_price ?? ''),
            quantity: String(product.quantity ?? ''),
            alert_threshold: String(product.alert_threshold ?? ''),
            expiry_date: product.expiry_date
                ? product.expiry_date.split('T')[0]
                : '',
            supplier_name: product.supplier_name || '',
            description: product.description || '',
            tablets_per_strip: product.tablets_per_strip ? String(product.tablets_per_strip) : '',
            batch_number: product.batch_number || '',
            hsn_code: product.hsn_code || '',
            gst: String(product.gst ?? ''),
        });
        setEditingId(product._id || product.id);
        setModalMode('view');
        setModalVisible(true);
    };

    const closeModal = () => {
        setModalVisible(false);
        setFormError('');
        setFormData(EMPTY_FORM);
        setEditingId(null);
    };

    // ─── SAVE (CREATE / UPDATE) ─────────────────────
    const handleSave = async () => {
        setFormError('');
        // Validate
        if (!formData.medicine_name.trim()) {
            setFormError('Medicine name is required.');
            return;
        }
        const mrpValue = Number(formData.mrp);
        if (isNaN(mrpValue) || mrpValue <= 0) {
            setFormError('MRP must be greater than 0.');
            return;
        }
        
        const qtyValue = Number(formData.quantity);
        if (isNaN(qtyValue) || qtyValue <= 0) {
            setFormError('Quantity must be greater than 0.');
            return;
        }

        const payload = {
            medicine_name: formData.medicine_name.trim(),
            mrp: Number(formData.mrp),
            cost_price: formData.cost_price ? Number(formData.cost_price) : undefined,
            quantity: Number(formData.quantity),
            alert_threshold: Number(formData.alert_threshold) || 2,
            expiry_date: formData.expiry_date || undefined,
            supplier_name: formData.supplier_name.trim() || undefined,
            description: formData.description.trim() || undefined,
            tablets_per_strip: formData.tablets_per_strip ? Number(formData.tablets_per_strip) : undefined,
            batch_number: formData.batch_number.trim() || undefined,
            hsn_code: formData.hsn_code.trim() || undefined,
            gst: formData.gst ? Number(formData.gst) : undefined,
        };

        setSaving(true);
        try {

            if (modalMode === 'edit' && editingId) {
                await updateProduct(editingId, payload);
            } else {
                await createProduct(payload);
            }

            closeModal();
            await fetchProducts();
        } catch (err) {
            if (err.status === 409 && err.data?.has_conflict) {
                setBatchConflicts([{
                    payload,
                    conflictData: err.data.conflict,
                    source: 'manual'
                }]);
                setConflictModalVisible(true);
            } else {
                setFormError(err.message || 'Failed to save product');
            }
        } finally {
            setSaving(false);
        }
    };

    // ─── DELETE ─────────────────────────────────────
    const confirmDelete = (product) => {
        setDeletingProduct(product);
        setDeleteModalVisible(true);
    };

    const handleReturnToSupplier = (product) => {
        setReturningProduct(product);
        setReturnModalVisible(true);
    };

    const executeReturnToSupplier = async () => {
        if (!returningProduct) return;
        
        const qty = Number(returningProduct.quantity ?? returningProduct.stock ?? 0);
        if (qty <= 0) {
            setReturnModalVisible(false);
            setReturningProduct(null);
            return;
        }
        
        const costPrice = Number(returningProduct.cost_price || returningProduct.mrp || 0);
        const lossSaved = qty * costPrice;

        setReturningLoading(true);
        try {
            const payload = {
                quantity: 0,
                returned_to_supplier: true,
                loss_saved_amount: lossSaved
            };
            await updateProduct(returningProduct._id || returningProduct.id, payload);
            await fetchProducts();
            setReturnModalVisible(false);
            setReturningProduct(null);
        } catch (err) {
            Alert.alert('Error', err.message || 'Failed to return items to supplier');
        } finally {
            setReturningLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!deletingProduct) return;
        setDeleting(true);
        try {
            await deleteProduct(deletingProduct._id || deletingProduct.id);
            setDeleteModalVisible(false);
            setDeletingProduct(null);
            await fetchProducts();
        } catch (err) {
            Alert.alert('Error', err.message || 'Failed to delete product');
        } finally {
            setDeleting(false);
        }
    };

    const openBlobInNewTab = (blob, type) => {
        if (Platform.OS === 'web') {
            const url = URL.createObjectURL(blob);
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = url;
            document.body.appendChild(iframe);
            iframe.onload = () => {
                iframe.contentWindow.print();
            };
            setTimeout(() => {
                if (document.body.contains(iframe)) {
                    document.body.removeChild(iframe);
                }
                URL.revokeObjectURL(url);
            }, 60000);
        } else {
            Alert.alert('Info', 'Printing is supported on the web version.');
        }
    };

    // ─── AUTO IMPORT HANDLERS ─────────────────────
    /**
     * Convert various expiry date formats to YYYY-MM-DD.
     * Medicines expire at the END of the month shown on the pack.
     * Handles: MM/YYYY  MM/YY  MM-YYYY  MM-YY  YYYY-MM-DD  (passthrough)
     */
    const parseExpiryDate = (raw) => {
        if (!raw) return '';
        const s = String(raw).trim();

        // Already YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

        // MM/YYYY or MM-YYYY (4-digit year)
        const m4 = s.match(/^(\d{1,2})[\/-](\d{4})$/);
        if (m4) {
            const month = parseInt(m4[1], 10);
            const year = parseInt(m4[2], 10);
            const last = new Date(year, month, 0).getDate(); // day 0 of next month = last day of this
            return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
        }

        // MM/YY or MM-YY (2-digit year)
        const m2 = s.match(/^(\d{1,2})[\/-](\d{2})$/);
        if (m2) {
            const month = parseInt(m2[1], 10);
            const year = 2000 + parseInt(m2[2], 10);
            const last = new Date(year, month, 0).getDate();
            return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
        }

        // Fallback — return as-is
        return s;
    };

    const showToast = (message) => {
        setToastMessage(message);
        setToastVisible(true);
        setTimeout(() => setToastVisible(false), 3500);
    };

    const handleAutoImportPress = () => {
        setAutoImportNoticeVisible(true);
    };

    const processAutoImportFile = async (file) => {
        setAutoImportUploading(true);
        setAutoImportError('');
        try {
            // STEP: Upload to AI for Extraction (Image optimization is now handled securely on the backend)
            console.log("[AutoImport] Sending raw file for backend AI extraction...");
            const result = await autoImportBill(file);

            // Extract metadata if available
            setAutoImportBillNo(result?.bill_no ?? result?.invoice_no ?? result?.data?.bill_no ?? '');
            setAutoImportBillDate(result?.bill_date ?? result?.date ?? result?.data?.date ?? '');

            // Store the purchase record ID so we can finalize it after confirm
            setAutoImportPurchaseId(result?.purchase_id ?? null);

            // Try every common envelope shape the backend might use
            let extracted =
                result?.products ??
                result?.data?.products ??
                result?.data?.medicines ??
                result?.data?.items ??
                result?.medicines ??
                result?.items ??
                (Array.isArray(result?.data) ? result.data : null) ??
                (Array.isArray(result) ? result : null) ??
                [];

            if (!Array.isArray(extracted) || extracted.length === 0) {
                const preview = JSON.stringify(result).slice(0, 200);
                setAutoImportError(`No medicines could be extracted. API info: ${preview}`);
                setAutoImportReviewVisible(true);
                return;
            }

            // Capture supplier from the root response if available
            const globalSupplier = result?.supplier_name ?? result?.supplierName ?? result?.supplier ?? result?.vendor_name ?? result?.vendorName ?? result?.vendor ?? 
                                   result?.data?.supplier_name ?? result?.data?.supplierName ?? result?.data?.supplier ?? result?.data?.vendor_name ?? result?.data?.vendorName ?? result?.data?.vendor ?? '';

            const normalised = extracted.map((item, idx) => ({
                _key: String(idx),
                medicine_name: String(
                    item.medicine_name ?? item.name ?? item.product_name ?? item.drug_name ?? item.item_name ??
                    item.brand_name ?? item.medicine ?? item.product ?? item.title ?? item.description ?? ''
                ),
                quantity: String(
                    item.quantity ?? item.qty ?? item.stock ?? item.units ?? ''
                ),
                mrp: String(
                    item.mrp ?? item.price ?? item.unit_price ?? item.rate ?? item.cost ?? item.amount ?? ''
                ),
                cost_price: String(
                    item.cost_price ?? item.cost ?? item.purchase_price ?? item.buy_price ?? item.purchase_rate ?? item.net_rate ?? ''
                ),
                supplier_name: String(
                    item.supplier_name ?? item.supplierName ?? item.supplier ?? item.vendor_name ?? item.vendorName ?? item.vendor ?? item.mfg ?? item.manufacturer ?? globalSupplier ?? ''
                ),
                expiry_date: parseExpiryDate(
                    item.expiry_date || item.expiry || item.exp_date || item.exp || item.expiration || item.expiration_date || ''
                ),
                batch_number: String(
                    item.batch_number || item.batch || item.batch_no || ''
                ),
                hsn_code: String(
                    item.hsn_code || item.hsn || item.hsn_no || ''
                ),
                gst: String(
                    item.gst ?? item.gst_rate ?? ''
                ),
            }));
            setAutoImportItems(normalised);
            setAutoImportReviewVisible(true);
        } catch (err) {
            console.error('[AutoImport] Error:', err);
            
            const errorMessage = (err?.response?.data?.message || err?.message || "").toLowerCase();
            let msg = "Please try again after 2 minutes. We couldn't get details from that image due to high traffic. Don't panic, just try again later.";
            
            if (err?.message === 'Network Error' || errorMessage.includes('network error') || err?.code === 'ERR_NETWORK') {
                msg = "Please connet to internet";
            } else if (err?.response?.status === 429 || err?.response?.status === 503 || errorMessage.includes('too many request') || errorMessage.includes('rate limit') || errorMessage.includes('server busy')) {
                msg = "Don't panic, ai servers are busy right now. Just try again 5 minutes later";
            }

            setAutoImportError(msg);
            setAutoImportReviewVisible(true); // open modal to show the error
        } finally {
            setAutoImportUploading(false);
        }
    };

    const updateAutoImportRow = (key, field, value) => {
        setAutoImportItems((prev) =>
            prev.map((item) =>
                item._key === key ? { ...item, [field]: value } : item
            )
        );
    };

    const removeAutoImportRow = (key) => {
        setAutoImportItems((prev) => prev.filter((item) => item._key !== key));
    };

    const handleConfirmAutoImport = async () => {
        // Guard against double-invocation (e.g. fast double-click)
        if (autoImportConfirming) return;
        if (autoImportItems.length === 0) {
            setAutoImportError('No items to import. Please keep at least one row.');
            return;
        }
        // Validate — every row needs a medicine name
        const invalidName = autoImportItems.find((item) => !item.medicine_name.trim());
        if (invalidName) {
            setAutoImportError('All rows must have a medicine name. Please fill in or remove empty rows.');
            return;
        }

        // Validate - MRP and Qty must be > 0
        const invalidQtyOrMrp = autoImportItems.find((item) => Number(item.quantity) <= 0 || Number(item.mrp) <= 0);
        if (invalidQtyOrMrp) {
            setAutoImportError('All items must have an MRP and Quantity greater than 0.');
            return;
        }
        setAutoImportConfirming(true);
        setAutoImportError('');
        try {
            // Use createProduct for each item so we're guaranteed to use the
            // same working endpoint as the normal Add Product flow.
            const results = [];

            for (const item of autoImportItems) {
                const payload = {
                    medicine_name: item.medicine_name.trim(),
                    quantity: Number(item.quantity) || 0,
                    mrp: Number(item.mrp) || 0,
                    cost_price: Number(item.cost_price) || undefined,
                    supplier_name: item.supplier_name ? item.supplier_name.trim() : undefined,
                    expiry_date: item.expiry_date || undefined,
                    batch_number: item.batch_number || undefined,
                    hsn_code: item.hsn_code || undefined,
                    gst: item.gst ? Number(item.gst) : undefined,
                    alert_threshold: 2,
                };
                try {
                    const res = await createProduct(payload);

                    results.push({ status: "fulfilled", value: res, originalKey: item._key });

                } catch (err) {
                    if (err.status === 409 && err.data?.has_conflict) {
                        results.push({ status: "conflict", payload, conflictData: err.data.conflict, originalKey: item._key });
                    } else {
                        results.push({ status: "rejected", reason: err, originalKey: item._key });
                    }
                }
            }

            const conflicts = results.filter((r) => r.status === 'conflict');
            const failed = results.filter((r) => r.status === 'rejected');
            const success = results.filter((r) => r.status === 'fulfilled');

            // Remove successfully imported ones from the screen
            const successKeys = success.map(s => s.originalKey);
            setAutoImportItems(prev => prev.filter(i => !successKeys.includes(i._key)));

            const newFinalizeItems = [];
            for (let i = 0; i < autoImportItems.length; i++) {
                if (results[i].status === 'fulfilled') {
                    const productData = results[i].value?.data?.data || results[i].value?.data || results[i].value;
                    if (productData?._id) {
                        newFinalizeItems.push({
                            inventoryId: productData._id,
                            quantity: Number(autoImportItems[i].quantity) || 0,
                            mrp: Number(autoImportItems[i].mrp) || 0,
                            cost_price: Number(autoImportItems[i].cost_price) || Number(autoImportItems[i].mrp) || 0,
                            supplier_name: autoImportItems[i].supplier_name || ''
                        });
                    }
                }
            }

            if (conflicts.length > 0) {
                setPendingFinalizeItems(newFinalizeItems);
                // Launch modal for conflicts
                setBatchConflicts(conflicts.map(c => ({
                    payload: c.payload,
                    conflictData: c.conflictData,
                    source: 'auto_import',
                    originalKey: c.originalKey,
                    originalItem: autoImportItems.find(item => item._key === c.originalKey)
                })));
                setConflictModalVisible(true);
                return; // Wait for user to resolve via modal
            }

            if (failed.length > 0 && success.length === 0) {
                // All failed
                setAutoImportError(
                    `All ${failed.length} product(s) failed to import.\n` +
                    (failed[0].reason?.message || '')
                );
                return;
            }

            // At least some succeeded
            setAutoImportReviewVisible(false);
            setAutoImportItems([]);
            setAutoImportError('');

            // ── Finalize the linked Purchase record (best-effort, non-blocking) ──
            if (autoImportPurchaseId) {
                await finalizePurchaseCall(newFinalizeItems);
            }

            if (failed.length > 0) {
                showToast(`⚠ ${success.length} imported, ${failed.length} failed`);
            } else {
                showToast(`✓ ${success.length} product${success.length !== 1 ? 's' : ''} added to inventory`);
            }

            await fetchProducts();
        } catch (err) {
            const msg = err?.message || 'Failed to save products. Please try again.';
            setAutoImportError(msg);
        } finally {
            setAutoImportConfirming(false);
        }
    };

    const closeAutoImportReview = () => {
        setAutoImportReviewVisible(false);
        setAutoImportItems([]);
        setAutoImportError('');
        setAutoImportPurchaseId(null);
    };

    // ─── RECENT BILLS LOGIC ───────────────────────
    const openRecentBillsModal = async () => {
        setRecentBillsModalVisible(true);
        setRecentBillsLoading(true);
        try {
            const res = await getPurchases();
            if (res.data) {
                // Only show bills that actually have imported items
                const validBills = res.data.filter(b => b.imported_items && b.imported_items.length > 0);
                setRecentBills(validBills);
            }
        } catch (err) {
            showToast('Failed to fetch recent bills');
        } finally {
            setRecentBillsLoading(false);
        }
    };

    const loadBillIntoLabels = (bill) => {
        const newCart = {};
        let count = 0;
        
        bill.imported_items.forEach(item => {
            const product = products.find(p => String(p._id) === String(item.inventoryId));
            if (product) {
                newCart[product._id] = item.quantity || 1;
                count += newCart[product._id];
            }
        });

        setLabelItems(newCart);
        setRecentBillsModalVisible(false);
        showToast(`Loaded ${count} labels from bill ${bill.bill_no || ''}`);
    };

    // ─── LABEL MODAL HANDLERS ────────────────────────
    const openLabelModal = () => {
        setLabelItems({});
        setLabelSearch('');
        setLabelLetter('All');
        setLabelModalVisible(true);
    };

    const closeLabelModal = () => {
        setLabelModalVisible(false);
        setLabelItems({});
        setLabelSearch('');
        setLabelLetter('All');
    };

    const toggleLabelItem = (id) => {
        setLabelItems((prev) => {
            const next = { ...prev };
            if (next[id] !== undefined) {
                delete next[id];
            } else {
                next[id] = 1;
            }
            return next;
        });
    };

    const setLabelCopies = (id, copies) => {
        const num = parseInt(copies, 10);
        setLabelItems((prev) => ({
            ...prev,
            [id]: isNaN(num) || num < 1 ? 1 : num,
        }));
    };

    const labelSelectedCount = Object.keys(labelItems).length;

    const filteredLabelProducts = useMemo(() => {
        let result = products;

        if (labelLetter !== 'All') {
            result = result.filter((p) => {
                const name = p.medicine_name || '';
                return name.trim().toUpperCase().startsWith(labelLetter);
            });
        }

        if (labelSearch.trim()) {
            const q = labelSearch.toLowerCase();
            result = result.filter(
                (p) =>
                    (p.medicine_name || '').toLowerCase().includes(q) ||
                    (p.supplier_name || '').toLowerCase().includes(q)
            );
        }
        return result;
    }, [products, labelSearch, labelLetter]);

    const handleSelectAllFiltered = () => {
        setLabelItems((prev) => {
            const next = { ...prev };
            filteredLabelProducts.forEach((p) => {
                const id = p._id || p.id;
                next[id] = p.quantity && p.quantity > 0 ? p.quantity : 1;
            });
            return next;
        });
    };

    const handleClearAllFiltered = () => {
        setLabelItems((prev) => {
            const next = { ...prev };
            filteredLabelProducts.forEach((p) => {
                const id = p._id || p.id;
                delete next[id];
            });
            return next;
        });
    };

    const handleGenerateLabels = () => {
        if (labelSelectedCount === 0) {
            Alert.alert('No Selection', 'Please select at least one product to generate labels.');
            return;
        }

        const totalCopies = Object.values(labelItems).reduce((sum, copies) => sum + (parseInt(copies, 10) || 1), 0);
        setGeneratingLabels(true);
        try {
            // Build the list of { product, copies } from the selected items
            const items = Object.entries(labelItems).map(([productId, copies]) => {
                const product = products.find(p => (p._id || p.id) === productId);
                return { product: product || { _id: productId, medicine_name: 'Unknown' }, copies };
            });
            printLabels58mm(items);
            closeLabelModal();
        } catch (err) {
            Alert.alert('Label Error', err.message || 'Failed to generate labels.');
        } finally {
            setGeneratingLabels(false);
        }
    };

    // ─── HELPERS ────────────────────────────────────
    const getStockStatus = (product) => {
        const qty = product.quantity ?? product.stock ?? 0;
        const threshold = product.alert_threshold ?? 2;
        if (qty === 0) return { label: 'Out of Stock', color: COLORS.error, bg: COLORS.errorLight };
        if (qty <= threshold) return { label: 'Low Stock', color: COLORS.warning, bg: COLORS.warningLight };
        return { label: 'In Stock', color: COLORS.success, bg: COLORS.successLight };
    };

    const getExpiryStatus = (product) => {
        if (!product.expiry_date) return null;
        const exp = new Date(product.expiry_date);
        const now = new Date();
        const diffDays = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return { label: 'Expired', color: COLORS.error, bg: COLORS.errorLight };
        if (diffDays <= 90) return { label: `${diffDays}d left`, color: COLORS.warning, bg: COLORS.warningLight };
        return null;
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '—';
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    };

    // ─── COUNT BADGES ────────────────────────────────
    const deadStockCount = products.filter((p) => {
        const qty = p.quantity ?? p.stock ?? 0;
        if (qty <= 0) return false;
        if (!p.createdAt) return false;
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        return new Date(p.createdAt) < threeMonthsAgo;
    }).length;

    const lowStockCount = products.filter((p) => {
        const qty = p.quantity ?? p.stock ?? 0;
        const threshold = p.alert_threshold ?? 2;
        return qty > 0 && qty <= threshold;
    }).length;

    const expiringSoonCount = products.filter((p) => {
        if (p.returned_to_supplier) return false;
        if (!p.expiry_date) return false;
        const exp = new Date(p.expiry_date);
        const now = new Date();
        const threeMonths = new Date();
        threeMonths.setMonth(threeMonths.getMonth() + 3);
        return exp >= now && exp <= threeMonths;
    }).length;

    const expiredCount = products.filter((p) => {
        if (p.returned_to_supplier) return false;
        if (!p.expiry_date) return false;
        return new Date(p.expiry_date) < new Date();
    }).length;



    const totalInventoryValue = useMemo(() => {
        return products.reduce((sum, p) => sum + (Number(p.mrp || 0) * Number(p.quantity ?? p.stock ?? 0)), 0);
    }, [products]);

    const totalLossSaved = useMemo(() => {
        return products.reduce((sum, p) => sum + (Number(p.loss_saved_amount || 0)), 0);
    }, [products]);

    // ─── RENDER PRODUCT ROW ─────────────────────────
    const renderProduct = useCallback(({ item, index }) => {
        const stockStatus = getStockStatus(item);
        const expiryStatus = getExpiryStatus(item);

        if (r.isSmall) {
            return (
                <TouchableOpacity
                    style={styles.mobileCard}
                    onPress={() => openViewModal(item)}
                    activeOpacity={0.7}
                >
                    <View style={styles.mobileCardHeader}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.cellName} numberOfLines={2}>{item.medicine_name || '—'}</Text>
                            <Text style={styles.cellSub}>{item.supplier_name || 'No supplier'}</Text>
                        </View>
                        <View style={styles.mobileCardPriceBox}>
                            <Text style={styles.cellPrice}>₹{Number(item.mrp ?? 0).toFixed(2)}</Text>
                        </View>
                    </View>

                    <View style={styles.mobileCardBody}>
                        <View style={styles.mobileCardStat}>
                            <Text style={styles.mobileStatLabel}>Stock</Text>
                            {stockStatus.label === 'Out of Stock' ? (
                                <View style={styles.outOfStockTag}>
                                    <Text style={styles.outOfStockTagText}>Out of stock</Text>
                                </View>
                            ) : (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <Text style={styles.mobileStatValue}>
                                        {item.quantity ?? item.stock ?? 0}
                                    </Text>
                                    {stockStatus.label === 'Low Stock' && (
                                        <View style={styles.lowStockTag}>
                                            <Text style={styles.lowStockTagText}>Low</Text>
                                        </View>
                                    )}
                                </View>
                            )}
                        </View>
                        <View style={styles.mobileCardStat}>
                            <Text style={styles.mobileStatLabel}>Expiry</Text>
                            <Text style={[
                                styles.mobileStatValue,
                                expiryStatus?.label === 'Expired' && { color: COLORS.error },
                                expiryStatus?.label?.includes('left') && { color: COLORS.warning }
                            ]}>
                                {formatDate(item.expiry_date)}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.mobileCardFooter}>
                        <View style={styles.mobileActionGroup}>
                            <TouchableOpacity style={styles.mobileActionBtn} onPress={() => openEditModal(item)}>
                                <Ionicons name="create-outline" size={18} color={COLORS.textSecondary} />
                                <Text style={styles.mobileActionText}>Edit</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.mobileActionBtn} onPress={() => printLabels58mm([{ product: item, copies: 1 }])}>
                                <Ionicons name="scan-outline" size={18} color={COLORS.textSecondary} />
                                <Text style={styles.mobileActionText}>Label</Text>
                            </TouchableOpacity>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            {(activeFilter === 'expiring_soon' || activeFilter === 'expired') && (item.quantity ?? item.stock ?? 0) > 0 && (
                                <TouchableOpacity style={[styles.mobileActionBtn, { borderLeftWidth: 0.5, borderLeftColor: 'rgba(0,0,0,0.1)', paddingLeft: 12, paddingRight: 12 }]} onPress={() => handleReturnToSupplier(item)}>
                                    <Ionicons name="return-up-back-outline" size={18} color={COLORS.warning} />
                                </TouchableOpacity>
                            )}
                            <TouchableOpacity style={[styles.mobileActionBtn, { borderLeftWidth: 0.5, borderLeftColor: 'rgba(0,0,0,0.1)', paddingLeft: 12 }]} onPress={() => confirmDelete(item)}>
                                <Ionicons name="trash-outline" size={18} color={COLORS.error} />
                            </TouchableOpacity>
                        </View>
                    </View>
                </TouchableOpacity>
            );
        }

        return (
            <TouchableOpacity
                style={styles.tableRow}
                onPress={() => openViewModal(item)}
                activeOpacity={0.7}
            >
                {/* Name */}
                <View style={[styles.tdCell, { flex: 2.5 }]}>
                    <Text style={styles.cellName} numberOfLines={1}>
                        {item.medicine_name || '—'}
                    </Text>
                    <Text style={styles.cellSub} numberOfLines={1}>
                        {item.supplier_name || 'No supplier'}
                    </Text>
                </View>

                {/* MRP */}
                <View style={[styles.tdCell, { flex: 0.8 }]}>
                    <Text
                        style={styles.cellPrice}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.8}
                    >
                        ₹{Number(item.mrp ?? 0).toFixed(2)}
                    </Text>
                </View>

                {/* Stock */}
                <View style={[styles.tdCell, { flex: 0.8, flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                    {stockStatus.label === 'Out of Stock' ? (
                        <View style={styles.outOfStockTag}>
                            <Text style={styles.outOfStockTagText} numberOfLines={1}>Out of stock</Text>
                        </View>
                    ) : (
                        <>
                            <Text style={styles.cellText} numberOfLines={1}>
                                {item.quantity ?? item.stock ?? 0}
                            </Text>
                            {stockStatus.label === 'Low Stock' && (
                                <View style={styles.lowStockTag}>
                                    <Text style={styles.lowStockTagText} numberOfLines={1}>Low</Text>
                                </View>
                            )}
                        </>
                    )}
                </View>

                {/* Expiry */}
                <View style={[styles.tdCell, { flex: 1.2 }]}>
                    <Text
                        style={[
                            styles.cellText,
                            expiryStatus?.label === 'Expired' && { color: COLORS.error },
                            expiryStatus?.label?.includes('left') && { color: COLORS.warning }
                        ]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.8}
                    >
                        {formatDate(item.expiry_date)}
                    </Text>
                </View>

                {/* Batch No */}
                <View style={[styles.tdCell, { flex: 1.0 }]}>
                    <Text
                        style={styles.cellText}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.8}
                    >
                        {item.batch_number || '—'}
                    </Text>
                </View>

                {/* HSN No */}
                <View style={[styles.tdCell, { flex: 0.8 }]}>
                    <Text
                        style={styles.cellText}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.8}
                    >
                        {item.hsn_code || '—'}
                    </Text>
                </View>

                {/* GST */}
                <View style={[styles.tdCell, { flex: 0.6 }]}>
                    <Text
                        style={styles.cellText}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.8}
                    >
                        {item.gst !== undefined ? `${item.gst}%` : '0%'}
                    </Text>
                </View>

                {/* Actions */}
                <View style={[styles.tdCell, styles.actionsCell, { flex: 1.1, borderRightWidth: 0 }]}>
                    <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => openEditModal(item)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Ionicons name="create-outline" size={16} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => printLabels58mm([{ product: item, copies: 1 }])}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Ionicons name="scan-outline" size={16} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                    {(activeFilter === 'expiring_soon' || activeFilter === 'expired') && (item.quantity ?? item.stock ?? 0) > 0 && (
                        <TouchableOpacity
                            style={styles.actionBtn}
                            onPress={() => handleReturnToSupplier(item)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                            <Ionicons name="return-up-back-outline" size={16} color={COLORS.warning} />
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity
                        style={[styles.actionBtn, styles.actionBtnDanger]}
                        onPress={() => confirmDelete(item)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Ionicons name="trash-outline" size={16} color={COLORS.error} />
                    </TouchableOpacity>
                </View>
            </TouchableOpacity>
        );
    }, [r.isSmall, openViewModal, openEditModal, confirmDelete, activeFilter, handleReturnToSupplier]);

    // ─── RENDER ─────────────────────────────────────
    return (
        <View style={styles.container}>
            {/* ─── HEADER ─── */}
            <View style={[
                styles.header,
                r.isSmall && {
                    paddingHorizontal: SPACING.md,
                    paddingVertical: 6,
                    gap: 8,
                    height: 54
                }
            ]}>
                <View style={{ flex: r.isSmall ? 0.8 : undefined }}>
                    <Text style={[styles.headerTitle, r.isSmall && { fontSize: 16 }]} numberOfLines={1}>Inventory</Text>
                    {!r.isSmall && (
                        <Text style={styles.headerSub}>
                            {products.length} products • {lowStockCount} low stock • {expiringSoonCount} expiring • Total Value: ₹{totalInventoryValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} • Loss saved from expiry: ₹{totalLossSaved.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Text>
                    )}
                </View>

                {/* headerActions row */}
                <View style={[
                    styles.headerActions,
                    r.isSmall && {
                        flex: 1.2,
                        flexDirection: 'row',
                        justifyContent: 'flex-end',
                        gap: 6
                    }
                ]}>
                    <TouchableOpacity
                        style={[styles.actionHeaderBtn, { height: r.isSmall ? 32 : 32, paddingHorizontal: r.isSmall ? 8 : 12 }]}
                        onPress={openLabelModal}
                    >
                        <Ionicons name="pricetag-outline" size={16} color={COLORS.textSecondary} />
                        {!r.isSmall && <Text style={styles.actionHeaderBtnText}>Labels</Text>}
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionHeaderBtnPrimary, { height: r.isSmall ? 32 : 32, paddingHorizontal: r.isSmall ? 10 : 12 }]}
                        onPress={openAddModal}
                    >
                        <Ionicons name="add-outline" size={16} color={COLORS.white} />
                        {!r.isSmall && <Text style={styles.actionHeaderBtnPrimaryText}>Add product</Text>}
                    </TouchableOpacity>
                </View>
            </View>

            {/* ─── TOOLBAR ROW (Tabs + Search) ─── */}
            <View style={[
                styles.filterBar,
                r.isSmall && styles.filterBarMobile
            ]}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterTabs}
                >
                    {FILTERS.map((filter) => {
                        const isActive = activeFilter === filter.key;
                        let badgeCount = 0;
                        if (filter.key === 'dead_stock') badgeCount = deadStockCount;

                        if (filter.key === 'expiring_soon') badgeCount = expiringSoonCount;
                        if (filter.key === 'expired') badgeCount = expiredCount;

                        return (
                            <TouchableOpacity
                                key={filter.key}
                                style={[
                                    styles.filterTab,
                                    isActive && styles.filterTabActive
                                ]}
                                onPress={() => setActiveFilter(filter.key)}
                                activeOpacity={0.7}
                            >
                                <Text style={[
                                    styles.filterTabText,
                                    isActive && styles.filterTabTextActive
                                ]}>
                                    {filter.label}
                                </Text>
                                {badgeCount > 0 && (
                                    <View style={[
                                        styles.filterTabBadge,
                                        filter.key === 'expired' ? styles.filterTabBadgeDanger : styles.filterTabBadgeWarning
                                    ]}>
                                        <Text style={[
                                            styles.filterTabBadgeText,
                                            filter.key === 'expired' ? styles.filterTabBadgeTextDanger : styles.filterTabBadgeTextWarning
                                        ]}>
                                            {badgeCount}
                                        </Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>

                {/* Search on Right */}
                <View style={[styles.filterBarRight, r.isSmall && styles.searchContainerMobile]} >
                    <View style={styles.searchBox}>
                        <Ionicons name="search-outline" size={16} color={COLORS.textMuted} />
                        <TextInput
                            style={styles.searchInput}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            placeholder="Search..."
                            placeholderTextColor={COLORS.textMuted}
                        />
                        {searchQuery.length > 0 && (
                            <TouchableOpacity onPress={() => setSearchQuery('')}>
                                <Ionicons name="close-circle" size={16} color={COLORS.textMuted} />
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
            </View>

            {/* ─── TABLE ─── */}
            <View style={[
                styles.tableContainer,
                r.isSmall && {
                    marginHorizontal: SPACING.md,
                    marginTop: SPACING.md
                }
            ]}>
                {loading ? (
                    <View style={{ flex: 1, padding: SPACING.md, gap: SPACING.sm }}>
                        {[...Array(8)].map((_, i) => (
                            <View key={i} style={[styles.tableRow, { height: 60, paddingHorizontal: SPACING.md, alignItems: 'center' }]}>
                                <View style={{ flex: 2.5, gap: 6 }}>
                                    <Skeleton width="60%" height={16} />
                                    <Skeleton width="40%" height={12} />
                                </View>
                                <Skeleton width="10%" height={16} style={{ flex: 0.8 }} />
                                <Skeleton width="10%" height={24} borderRadius={12} style={{ flex: 0.8, alignSelf: 'center' }} />
                                <Skeleton width="15%" height={16} style={{ flex: 1.2, marginLeft: SPACING.lg }} />
                                <Skeleton width="12%" height={16} style={{ flex: 1.2, marginLeft: SPACING.lg }} />
                                <Skeleton width="15%" height={24} style={{ flex: 1.1 }} />
                            </View>
                        ))}
                    </View>
                ) : (
                    <FlatList
                        data={filteredProducts}
                        keyExtractor={(item, i) => item._id || item.id || String(i)}
                        contentContainerStyle={filteredProducts.length === 0 ? { flexGrow: 1 } : null}
                        ListHeaderComponent={!r.isSmall ? () => (
                            <View style={styles.tableHeader}>
                                <View style={[styles.thCell, { flex: 2.5 }]}>
                                    <Text style={styles.th}>Medicine</Text>
                                </View>
                                <View style={[styles.thCell, { flex: 0.8 }]}>
                                    <Text style={styles.th}>MRP</Text>
                                </View>
                                <View style={[styles.thCell, { flex: 0.8 }]}>
                                    <Text style={styles.th}>Stock</Text>
                                </View>
                                <View style={[styles.thCell, { flex: 1.2 }]}>
                                    <Text style={styles.th}>Expiry</Text>
                                </View>
                                <View style={[styles.thCell, { flex: 1.0 }]}>
                                    <Text style={styles.th}>Batch No</Text>
                                </View>
                                <View style={[styles.thCell, { flex: 0.8 }]}>
                                    <Text style={styles.th}>HSN No</Text>
                                </View>
                                <View style={[styles.thCell, { flex: 0.6 }]}>
                                    <Text style={styles.th}>GST</Text>
                                </View>
                                <View style={[styles.thCell, { flex: 1.1, borderRightWidth: 0, alignItems: 'center' }]}>
                                    <Text style={styles.th}>Actions</Text>
                                </View>
                            </View>
                        ) : null}
                        stickyHeaderIndices={!r.isSmall ? [0] : undefined}
                        ListEmptyComponent={() => (
                            <View style={styles.centerBox}>
                                <Ionicons
                                    name={
                                        activeFilter === 'dead_stock' ? 'archive-outline' :
                                            activeFilter === 'expiring_soon' ? 'time-outline' :
                                                activeFilter === 'expired' ? 'skull-outline' :
                                                        'cube-outline'
                                    }
                                    size={56}
                                    color={activeFilter === 'expired' ? COLORS.error : COLORS.border}
                                />
                                <Text style={[
                                    styles.emptyText,
                                    activeFilter === 'expired' && !searchQuery && { color: COLORS.success },
                                ]}>
                                    {searchQuery
                                        ? 'No products match your search'
                                        : activeFilter === 'expired'
                                            ? '✓ No expired products — stock is clean!'
                                            : activeFilter === 'zero_stock'
                                                ? '✓ All products have stock — nothing is empty!'
                                                : `No ${activeFilter === 'all' ? '' : activeFilter.replace('_', ' ')} products`}
                                </Text>
                            </View>
                        )}
                        renderItem={renderProduct}
                        showsVerticalScrollIndicator={true}
                        onRefresh={onRefresh}
                        refreshing={refreshing}
                        initialNumToRender={15}
                        maxToRenderPerBatch={15}
                        windowSize={7}
                        removeClippedSubviews={true}
                    />
                )}
            </View>

            {/* ─── ADD / EDIT MODAL ─── */}
            <Modal visible={modalVisible} animationType="fade" transparent>
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalCard, { width: r.pick({ small: '95%', medium: '85%', large: '70%', xlarge: 700 }) }]}>
                        {/* Modal Header */}
                        <View style={styles.modalHeader}>
                            <View style={styles.modalHeaderLeft}>
                                <View style={[styles.modalIcon, {
                                    backgroundColor: modalMode === 'view' ? COLORS.infoLight :
                                        modalMode === 'edit' ? COLORS.warningLight : COLORS.primaryGhost
                                }]}>
                                    <Ionicons
                                        name={modalMode === 'view' ? 'eye-outline' : modalMode === 'edit' ? 'create-outline' : 'add-circle-outline'}
                                        size={22}
                                        color={modalMode === 'view' ? COLORS.info : modalMode === 'edit' ? COLORS.warning : COLORS.primary}
                                    />
                                </View>
                                <Text style={styles.modalTitle}>
                                    {modalMode === 'view' ? 'Product Details' : modalMode === 'edit' ? 'Edit Product' : 'Add New Product'}
                                </Text>
                            </View>
                            <TouchableOpacity onPress={closeModal} style={styles.modalCloseBtn}>
                                <Ionicons name="close" size={24} color={COLORS.textMuted} />
                            </TouchableOpacity>
                        </View>

                        {/* Modal Body */}
                        <ScrollView
                            style={styles.modalBody}
                            contentContainerStyle={styles.modalBodyContent}
                            showsVerticalScrollIndicator={false}
                        >
                            {formError ? (
                                <View style={{ backgroundColor: '#fef2f2', padding: 12, borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: '#fecaca', flexDirection: 'row', alignItems: 'center' }}>
                                    <Ionicons name="alert-circle" size={20} color="#ef4444" style={{ marginRight: 8 }} />
                                    <Text style={{ color: '#b91c1c', fontSize: 13, fontWeight: '500', flex: 1 }}>{formError}</Text>
                                </View>
                            ) : null}

                            {modalMode === 'view' ? (
                                <View style={styles.detailsContainer}>
                                    <View style={styles.detailCard}>
                                        <Text style={styles.detailSectionTitle}>Basic Information</Text>
                                        <View style={styles.detailRow}>
                                            <View style={styles.detailItem}>
                                                <Text style={styles.detailLabel}>Medicine Name</Text>
                                                <Text style={[styles.detailValue, { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary }]}>{formData.medicine_name || '—'}</Text>
                                            </View>
                                        </View>

                                        <View style={styles.detailRow}>
                                            <View style={styles.detailItem}>
                                                <Text style={styles.detailLabel}>Supplier Name</Text>
                                                <Text style={[styles.detailValue, { color: COLORS.primary, fontWeight: '600' }]}>
                                                    <Ionicons name="business-outline" size={14} /> {formData.supplier_name || 'No supplier documented'}
                                                </Text>
                                            </View>
                                        </View>
                                    </View>

                                    <View style={styles.detailCard}>
                                        <Text style={styles.detailSectionTitle}>Pricing & Stock</Text>
                                        <View style={styles.detailRow}>
                                            <View style={styles.detailItem}>
                                                <Text style={styles.detailLabel}>MRP</Text>
                                                <Text style={styles.detailValue}>₹{formData.mrp || '0.00'}</Text>
                                            </View>
                                            <View style={styles.detailItem}>
                                                <Text style={styles.detailLabel}>Cost Price</Text>
                                                <Text style={[styles.detailValue, { color: COLORS.success, fontWeight: '700' }]}>
                                                    ₹{formData.cost_price || '0.00'}
                                                </Text>
                                            </View>
                                        </View>

                                        <View style={styles.detailRow}>
                                            <View style={styles.detailItem}>
                                                <Text style={styles.detailLabel}>Current Stock</Text>
                                                <Text style={[styles.detailValue, { fontWeight: '700' }]}>{formData.quantity || '0'}</Text>
                                            </View>
                                            <View style={styles.detailItem}>
                                                <Text style={styles.detailLabel}>Alert Threshold</Text>
                                                <Text style={styles.detailValue}>{formData.alert_threshold || '2'}</Text>
                                            </View>
                                        </View>
                                    </View>

                                    <View style={styles.detailCard}>
                                        <Text style={styles.detailSectionTitle}>Additional Details</Text>
                                        <View style={styles.detailRow}>
                                            <View style={styles.detailItem}>
                                                <Text style={styles.detailLabel}>Expiry Date</Text>
                                                <Text style={styles.detailValue}>
                                                    {formData.expiry_date ? formData.expiry_date : '—'}
                                                </Text>
                                            </View>
                                            <View style={styles.detailItem}>
                                                <Text style={styles.detailLabel}>Tablets per Strip</Text>
                                                <Text style={styles.detailValue}>{formData.tablets_per_strip || '—'}</Text>
                                            </View>
                                        </View>

                                        <View style={styles.detailRow}>
                                            <View style={styles.detailItem}>
                                                <Text style={styles.detailLabel}>Batch Number</Text>
                                                <Text style={styles.detailValue}>{formData.batch_number || '—'}</Text>
                                            </View>
                                            <View style={styles.detailItem}>
                                                <Text style={styles.detailLabel}>HSN Code</Text>
                                                <Text style={styles.detailValue}>{formData.hsn_code || '—'}</Text>
                                            </View>
                                            <View style={styles.detailItem}>
                                                <Text style={styles.detailLabel}>GST (%)</Text>
                                                <Text style={styles.detailValue}>{formData.gst ? `${formData.gst}%` : '0%'}</Text>
                                            </View>
                                        </View>

                                        <View style={styles.detailRow}>
                                            <View style={styles.detailItem}>
                                                <Text style={styles.detailLabel}>Description</Text>
                                                <Text style={styles.detailValue}>{formData.description || 'No description provided.'}</Text>
                                            </View>
                                        </View>
                                    </View>
                                </View>
                            ) : (
                                <View style={styles.formGrid}>
                                    <View style={styles.formRow}>
                                        <View style={{ flex: 1 }}>
                                            <FormField
                                                label="Medicine Name"
                                                value={formData.medicine_name}
                                                onChangeText={(v) => setFormData({ ...formData, medicine_name: v })}
                                                placeholder="e.g. Paracetamol 500mg"
                                                required
                                                editable={modalMode !== 'view'}
                                            />
                                        </View>
                                    </View>

                                    <View style={styles.formRow}>
                                        <View style={{ flex: 1 }}>
                                            <FormField
                                                label="MRP (₹)"
                                                value={formData.mrp}
                                                onChangeText={(v) => setFormData({ ...formData, mrp: v })}
                                                placeholder="0.00"
                                                keyboardType="numeric"
                                                required
                                                editable={modalMode !== 'view'}
                                            />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <FormField
                                                label="Cost Price (₹)"
                                                value={formData.cost_price}
                                                onChangeText={(v) => setFormData({ ...formData, cost_price: v })}
                                                placeholder="0.00"
                                                keyboardType="numeric"
                                                editable={modalMode !== 'view'}
                                            />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <FormField
                                                label="Quantity"
                                                value={formData.quantity}
                                                onChangeText={(v) => setFormData({ ...formData, quantity: v })}
                                                placeholder="0"
                                                keyboardType="numeric"
                                                required
                                                editable={modalMode !== 'view'}
                                            />
                                        </View>
                                    </View>

                                    <View style={styles.formRow}>
                                        <View style={{ flex: 1 }}>
                                            <DateField
                                                label="Expiry Date"
                                                value={formData.expiry_date}
                                                onChangeDate={(v) => setFormData({ ...formData, expiry_date: v })}
                                                editable={modalMode !== 'view'}
                                            />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <FormField
                                                label="Batch Number"
                                                value={formData.batch_number}
                                                onChangeText={(v) => setFormData({ ...formData, batch_number: v })}
                                                placeholder="e.g. B12345"
                                                editable={modalMode !== 'view'}
                                            />
                                        </View>
                                    </View>

                                    <View style={styles.formRow}>
                                        <View style={{ flex: 1 }}>
                                            <FormField
                                                label="HSN Code"
                                                value={formData.hsn_code}
                                                onChangeText={(v) => setFormData({ ...formData, hsn_code: v })}
                                                placeholder="e.g. 3004"
                                                editable={modalMode !== 'view'}
                                            />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <FormField
                                                label="GST (%)"
                                                value={formData.gst}
                                                onChangeText={(v) => setFormData({ ...formData, gst: v })}
                                                placeholder="e.g. 12"
                                                keyboardType="numeric"
                                                editable={modalMode !== 'view'}
                                            />
                                        </View>
                                    </View>

                                    <View style={styles.formRow}>
                                        <View style={{ flex: 1 }}>
                                            <FormField
                                                label="Supplier Name"
                                                value={formData.supplier_name}
                                                onChangeText={(v) => setFormData({ ...formData, supplier_name: v })}
                                                placeholder="e.g. ABC Pharma"
                                                editable={modalMode !== 'view'}
                                            />
                                        </View>
                                    </View>

                                    <View style={styles.formRow}>
                                        <View style={{ flex: 1 }}>
                                            <FormField
                                                label="Alert Threshold"
                                                value={formData.alert_threshold}
                                                onChangeText={(v) => setFormData({ ...formData, alert_threshold: v })}
                                                placeholder="10"
                                                keyboardType="numeric"
                                                editable={modalMode !== 'view'}
                                            />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <FormField
                                                label="Tablets per Strip"
                                                value={formData.tablets_per_strip}
                                                onChangeText={(v) => setFormData({ ...formData, tablets_per_strip: v.replace(/[^0-9]/g, '') })}
                                                placeholder="e.g. 10"
                                                keyboardType="numeric"
                                                editable={modalMode !== 'view'}
                                            />
                                        </View>
                                    </View>

                                    <FormField
                                        label="Description"
                                        value={formData.description}
                                        onChangeText={(v) => setFormData({ ...formData, description: v })}
                                        placeholder="Optional product description..."
                                        multiline
                                        editable={modalMode !== 'view'}
                                    />
                                </View>
                            )}
                        </ScrollView>

                        {/* Modal Footer */}
                        {modalMode !== 'view' && (
                            <View style={styles.modalFooter}>
                                <GradientButton
                                    title="Cancel"
                                    variant="secondary"
                                    onPress={closeModal}
                                    style={{ flex: 1 }}
                                />
                                <GradientButton
                                    title={modalMode === 'edit' ? 'Update Product' : 'Add Product'}
                                    onPress={handleSave}
                                    loading={saving}
                                    icon={<Ionicons name={modalMode === 'edit' ? 'checkmark' : 'add'} size={20} color={COLORS.white} />}
                                    style={{ flex: 2 }}
                                />
                            </View>
                        )}
                        {modalMode === 'view' && (
                            <View style={styles.modalFooter}>
                                <GradientButton
                                    title="Close"
                                    variant="secondary"
                                    onPress={closeModal}
                                    style={{ flex: 1 }}
                                />
                                <GradientButton
                                    title="Edit"
                                    onPress={() => setModalMode('edit')}
                                    icon={<Ionicons name="create-outline" size={20} color={COLORS.white} />}
                                    style={{ flex: 1 }}
                                />
                            </View>
                        )}
                    </View>
                </View>
            </Modal>

            {/* ─── DELETE CONFIRM MODAL ─── */}
            <Modal visible={deleteModalVisible} animationType="fade" transparent>
                <View style={styles.modalOverlay}>
                    <View style={[styles.deleteModal, { width: r.pick({ small: '90%', medium: 400, large: 400, xlarge: 400 }) }]}>
                        <View style={styles.deleteIconBox}>
                            <Ionicons name="warning" size={36} color={COLORS.error} />
                        </View>
                        <Text style={styles.deleteTitle}>Delete Product?</Text>
                        <Text style={styles.deleteDesc}>
                            Are you sure you want to delete{' '}
                            <Text style={{ fontWeight: '700' }}>
                                {deletingProduct?.medicine_name || 'this product'}
                            </Text>
                            ? This action cannot be undone.
                        </Text>
                        <View style={styles.deleteActions}>
                            <GradientButton
                                title="Cancel"
                                variant="secondary"
                                onPress={() => {
                                    setDeleteModalVisible(false);
                                    setDeletingProduct(null);
                                }}
                                style={{ flex: 1 }}
                            />
                            <GradientButton
                                title="Delete"
                                variant="danger"
                                onPress={handleDelete}
                                loading={deleting}
                                icon={<Ionicons name="trash" size={18} color={COLORS.white} />}
                                style={{ flex: 1 }}
                            />
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ─── RETURN CONFIRM MODAL ─── */}
            <Modal visible={returnModalVisible} animationType="fade" transparent>
                <View style={styles.modalOverlay}>
                    <View style={[styles.deleteModal, { width: r.pick({ small: '90%', medium: 400, large: 400, xlarge: 400 }) }]}>
                        <View style={[styles.deleteIconBox, { backgroundColor: COLORS.warningLight }]}>
                            <Ionicons name="return-up-back" size={36} color={COLORS.warning} />
                        </View>
                        <Text style={styles.deleteTitle}>Return to Supplier?</Text>
                        <Text style={styles.deleteDesc}>
                            Are you sure you want to return <Text style={{ fontWeight: '700' }}>{returningProduct?.quantity ?? returningProduct?.stock ?? 0}</Text> remaining units of{' '}
                            <Text style={{ fontWeight: '700' }}>
                                {returningProduct?.medicine_name || 'this product'}
                            </Text>
                            {' '}to the supplier?
                            {'\n\n'}
                            This will save <Text style={{ fontWeight: '700', color: COLORS.success }}>₹{((returningProduct?.quantity ?? returningProduct?.stock ?? 0) * (returningProduct?.cost_price || returningProduct?.mrp || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text> from expiry loss.
                        </Text>
                        <View style={styles.deleteActions}>
                            <GradientButton
                                title="Cancel"
                                variant="secondary"
                                onPress={() => {
                                    setReturnModalVisible(false);
                                    setReturningProduct(null);
                                }}
                                style={{ flex: 1 }}
                            />
                            <GradientButton
                                title="Return Items"
                                variant="primary"
                                onPress={executeReturnToSupplier}
                                loading={returningLoading}
                                icon={<Ionicons name="return-up-back" size={18} color={COLORS.white} />}
                                style={{ flex: 1 }}
                            />
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ─── LABEL PRINTING MODAL ─── */}
            <Modal visible={labelModalVisible} animationType="fade" transparent>
                <View style={styles.modalOverlay}>
                    <View style={[styles.labelModalCard, { width: r.pick({ small: '95%', medium: '85%', large: '70%', xlarge: 750 }) }]}>
                        {/* Header */}
                        <View style={styles.modalHeader}>
                            <View style={styles.modalHeaderLeft}>
                                <View style={[styles.modalIcon, { backgroundColor: COLORS.accentLight }]}>
                                    <Ionicons name="pricetag-outline" size={22} color={COLORS.accent} />
                                </View>
                                <View>
                                    <Text style={styles.modalTitle}>Print Labels</Text>
                                    <Text style={styles.labelModalSub}>
                                        {labelSelectedCount} product{labelSelectedCount !== 1 ? 's' : ''} selected
                                    </Text>
                                </View>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                <TouchableOpacity 
                                    onPress={openRecentBillsModal} 
                                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.bgInput, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}
                                >
                                    <Ionicons name="document-text-outline" size={18} color={COLORS.primary} />
                                    <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.primary }}>Load from Bill</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={closeLabelModal} style={styles.modalCloseBtn}>
                                    <Ionicons name="close" size={24} color={COLORS.textMuted} />
                                </TouchableOpacity>
                            </View>
                        </View>

                        {/* Alphabet Filter */}
                        <View style={[styles.labelAlphabetBox, { width: '100%', paddingHorizontal: SPACING.md, zIndex: 10 }]}>
                            <TouchableOpacity
                                style={{
                                    borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
                                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.bgInput,
                                    width: 150
                                }}
                                onPress={() => setLabelLetterDropdown(!labelLetterDropdown)}
                            >
                                <Text style={{ fontSize: 13, fontWeight: '500', color: COLORS.textPrimary }}>First Letter: {labelLetter}</Text>
                                <Ionicons name={labelLetterDropdown ? "chevron-up" : "chevron-down"} size={16} color={COLORS.textMuted} />
                            </TouchableOpacity>

                            {labelLetterDropdown && (
                                <View style={{ position: 'absolute', top: 45, left: SPACING.md, width: 150, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, maxHeight: 200, zIndex: 999, elevation: 5, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { height: 2, width: 0 } }}>
                                    <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                                        {['All', ...Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i))].map(letter => (
                                            <TouchableOpacity
                                                key={letter}
                                                style={{ paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 0.5, borderBottomColor: COLORS.borderLight, backgroundColor: labelLetter === letter ? COLORS.accentLight : COLORS.white }}
                                                onPress={() => { setLabelLetter(letter); setLabelLetterDropdown(false); }}
                                            >
                                                <Text style={{ fontSize: 13, color: labelLetter === letter ? COLORS.accent : COLORS.textPrimary, fontWeight: labelLetter === letter ? '600' : '400' }}>{letter}</Text>
                                            </TouchableOpacity>
                                        ))}
                                    </ScrollView>
                                </View>
                            )}
                        </View>

                        {/* Search */}
                        <View style={styles.labelSearchBox}>
                            <Ionicons name="search-outline" size={20} color={COLORS.textMuted} />
                            <TextInput
                                style={styles.labelSearchInput}
                                value={labelSearch}
                                onChangeText={setLabelSearch}
                                placeholder="Search products..."
                                placeholderTextColor={COLORS.textMuted}
                            />
                            {labelSearch.length > 0 && (
                                <TouchableOpacity onPress={() => setLabelSearch('')}>
                                    <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* Select All / Clear All Row */}
                        {filteredLabelProducts.length > 0 && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 0.5, borderBottomColor: COLORS.border, backgroundColor: COLORS.bgBody }}>
                                <Text style={{ fontSize: 11, color: COLORS.textMuted }}>{filteredLabelProducts.length} items shown</Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <TouchableOpacity onPress={handleClearAllFiltered} style={{ marginRight: 16 }}>
                                        <Text style={{ fontSize: 12, color: COLORS.error, fontWeight: '600' }}>Clear Selection</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={handleSelectAllFiltered}>
                                        <Text style={{ fontSize: 12, color: COLORS.primary, fontWeight: '600' }}>Select All Shown</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}

                        {/* Product List */}
                        <FlatList
                            data={filteredLabelProducts}
                            keyExtractor={(item, i) => item._id || item.id || String(i)}
                            style={styles.labelList}
                            showsVerticalScrollIndicator={false}
                            ListEmptyComponent={
                                <View style={styles.labelEmptyBox}>
                                    <Ionicons name="cube-outline" size={40} color={COLORS.border} />
                                    <Text style={styles.labelEmptyText}>No products found</Text>
                                </View>
                            }
                            renderItem={({ item }) => {
                                const id = item._id || item.id;
                                const isChecked = labelItems[id] !== undefined;
                                return (
                                    <View style={[styles.labelRow, isChecked && styles.labelRowSelected]}>
                                        <TouchableOpacity
                                            style={styles.labelRowLeft}
                                            onPress={() => toggleLabelItem(id)}
                                            activeOpacity={0.7}
                                        >
                                            <View style={[styles.checkbox, isChecked && styles.checkboxChecked]}>
                                                {isChecked && (
                                                    <Ionicons name="checkmark" size={14} color={COLORS.white} />
                                                )}
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.labelProductName} numberOfLines={1}>
                                                    {item.medicine_name || '—'}
                                                </Text>
                                                <Text style={styles.labelProductSub} numberOfLines={1}>
                                                    MRP: ₹{Number(item.mrp ?? 0).toFixed(2)}  •  Stock: {item.quantity ?? item.stock ?? 0}
                                                </Text>
                                            </View>
                                        </TouchableOpacity>
                                        {isChecked && (
                                            <View style={styles.labelCopiesBox}>
                                                <Text style={styles.labelCopiesLabel}>Copies</Text>
                                                <View style={styles.labelCopiesInputRow}>
                                                    <TouchableOpacity
                                                        style={styles.labelCopiesStepBtn}
                                                        onPress={() => setLabelCopies(id, (labelItems[id] || 1) - 1)}
                                                    >
                                                        <Ionicons name="remove" size={16} color={COLORS.textSecondary} />
                                                    </TouchableOpacity>
                                                    <TextInput
                                                        style={styles.labelCopiesInput}
                                                        value={String(labelItems[id] || 1)}
                                                        onChangeText={(v) => setLabelCopies(id, v)}
                                                        keyboardType="numeric"
                                                        selectTextOnFocus
                                                    />
                                                    <TouchableOpacity
                                                        style={styles.labelCopiesStepBtn}
                                                        onPress={() => setLabelCopies(id, (labelItems[id] || 1) + 1)}
                                                    >
                                                        <Ionicons name="add" size={16} color={COLORS.textSecondary} />
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                        )}
                                    </View>
                                );
                            }}
                        />

                        {/* Limit Warning Message Removed */}

                        {/* Footer */}
                        <View style={styles.labelModalFooter}>
                            <GradientButton
                                title="Cancel"
                                variant="secondary"
                                onPress={closeLabelModal}
                                style={{ flex: 1 }}
                            />
                            <GradientButton
                                title={generatingLabels ? 'Generating...' : `Generate ${labelSelectedCount} Label${labelSelectedCount !== 1 ? 's' : ''}`}
                                onPress={handleGenerateLabels}
                                loading={generatingLabels}
                                disabled={labelSelectedCount === 0}
                                icon={<Ionicons name="print" size={20} color={COLORS.white} />}
                                style={{ flex: 2 }}
                            />
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ─── RECENT BILLS SELECTOR MODAL ─── */}
            <Modal visible={recentBillsModalVisible} animationType="fade" transparent>
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalCard, { width: 450, maxHeight: '80%' }]}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Load Labels from Bill</Text>
                            <TouchableOpacity onPress={() => setRecentBillsModalVisible(false)} style={styles.modalCloseBtn}>
                                <Ionicons name="close" size={24} color={COLORS.textMuted} />
                            </TouchableOpacity>
                        </View>
                        {recentBillsLoading ? (
                            <ActivityIndicator size="large" color={COLORS.primary} style={{ padding: 40 }} />
                        ) : recentBills.length === 0 ? (
                            <Text style={{ padding: 40, textAlign: 'center', color: COLORS.textMuted }}>No recent bills with imported items found.</Text>
                        ) : (
                            <ScrollView style={{ padding: 16 }}>
                                {recentBills.map(bill => (
                                    <TouchableOpacity 
                                        key={bill._id} 
                                        style={{ backgroundColor: COLORS.bgInput, padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border }}
                                        onPress={() => loadBillIntoLabels(bill)}
                                    >
                                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                                            <Text style={{ fontWeight: '700', fontSize: 15, color: COLORS.text }}>{bill.supplier_name || 'Unknown Supplier'}</Text>
                                            <Text style={{ fontWeight: '600', color: COLORS.primary }}>{bill.imported_items.length} items</Text>
                                        </View>
                                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                            <Text style={{ fontSize: 13, color: COLORS.textMuted }}>{bill.bill_no ? `Invoice: ${bill.bill_no}` : 'No invoice #'}</Text>
                                            <Text style={{ fontSize: 13, color: COLORS.textMuted }}>
                                                {new Date(bill.createdAt).toLocaleDateString()}
                                            </Text>
                                        </View>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        )}
                    </View>
                </View>
            </Modal>

            {/* ─── ENTERTAINING LOADING MODAL ─── */}
            <Modal visible={autoImportUploading} transparent animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalCard, { width: 340, padding: 32, alignItems: 'center', justifyContent: 'center' }]}>
                        <ActivityIndicator size="large" color={COLORS.primary} style={{ marginBottom: 20, transform: [{ scale: 1.2 }] }} />
                        <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 8 }}>Analyzing Invoice...</Text>
                        
                        <View style={{ marginTop: 10 }}>
                            <FlappyBird />
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ─── AUTO IMPORT REVIEW MODAL ─── */}
            <Modal visible={autoImportReviewVisible} animationType="fade" transparent>
                <View style={styles.modalOverlay}>
                    <View style={[styles.autoImportModalCard, { width: r.pick({ small: '97%', medium: '95%', large: '90%', xlarge: 920 }) }]}>
                        {/* Header */}
                        <View style={styles.modalHeader}>
                            <View style={[styles.modalHeaderLeft, { flex: 1 }]}>
                                <View style={[styles.modalIcon, { backgroundColor: COLORS.primaryGhost }]}>
                                    <Ionicons name="sparkles-outline" size={22} color={COLORS.primary} />
                                </View>
                                <View style={{ flex: 1, paddingRight: 8 }}>
                                    <Text style={[styles.modalTitle, { flexWrap: 'wrap' }]}>Review Extracted Medicines</Text>
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: r.isSmall ? 4 : 12, marginTop: 4 }}>
                                        {autoImportBillNo ? (
                                            <Text style={styles.autoImportSubtitle}>Invoice: {autoImportBillNo}</Text>
                                        ) : null}
                                        {autoImportBillDate ? (
                                            <Text style={styles.autoImportSubtitle}>Date: {autoImportBillDate}</Text>
                                        ) : null}
                                        <Text style={styles.autoImportSubtitle}>
                                            {autoImportItems.length} item{autoImportItems.length !== 1 ? 's' : ''}
                                        </Text>
                                    </View>
                                </View>
                            </View>
                            <TouchableOpacity onPress={closeAutoImportReview} style={styles.modalCloseBtn}>
                                <Ionicons name="close" size={24} color={COLORS.textMuted} />
                            </TouchableOpacity>
                        </View>

                        {/* ─── Error Banner (web-safe, replaces Alert) ─── */}
                        {!!autoImportError && (
                            <View style={styles.aiErrorBanner}>
                                <Ionicons name="alert-circle" size={20} color={COLORS.warning} />
                                <Text style={styles.aiErrorText} selectable>{autoImportError}</Text>
                            </View>
                        )}

                        {/* Column Headers + Body wrapped in a table box */}
                        {!autoImportError && (
                            <View style={[styles.aiTableContainer, r.isSmall && { marginHorizontal: SPACING.sm, borderWidth: 0, backgroundColor: 'transparent' }]}>
                                {/* Header */}
                                {!r.isSmall && (
                                    <View style={styles.aiTableHeader}>
                                        <View style={[styles.aiThCell, { flex: 2.0 }]}>
                                            <Text style={styles.aiTh}>Medicine Name *</Text>
                                        </View>
                                        <View style={[styles.aiThCell, { flex: 0.6 }]}>
                                            <Text style={styles.aiTh}>Qty</Text>
                                        </View>
                                        <View style={[styles.aiThCell, { flex: 0.7 }]}>
                                            <Text style={styles.aiTh}>MRP</Text>
                                        </View>
                                        <View style={[styles.aiThCell, { flex: 0.7 }]}>
                                            <Text style={styles.aiTh}>Cost</Text>
                                        </View>
                                        <View style={[styles.aiThCell, { flex: 0.9 }]}>
                                            <Text style={styles.aiTh}>Batch</Text>
                                        </View>
                                        <View style={[styles.aiThCell, { flex: 0.8 }]}>
                                            <Text style={styles.aiTh}>HSN</Text>
                                        </View>
                                        <View style={[styles.aiThCell, { flex: 0.6 }]}>
                                            <Text style={styles.aiTh}>GST</Text>
                                        </View>
                                        <View style={[styles.aiThCell, { flex: 1.2 }]}>
                                            <Text style={styles.aiTh}>Supplier</Text>
                                        </View>
                                        <View style={[styles.aiThCell, { flex: 1.1 }]}>
                                            <Text style={styles.aiTh}>Expiry</Text>
                                        </View>
                                        <View style={[styles.aiThCell, { flex: 0.4, borderRightWidth: 0 }]}>
                                        </View>
                                    </View>
                                )}

                                {/* Editable Rows */}
                                <ScrollView style={styles.aiTableBody} showsVerticalScrollIndicator={false}>
                                    {autoImportItems.length === 0 ? (
                                        <View style={styles.aiEmptyBox}>
                                            <Ionicons name="cube-outline" size={40} color={COLORS.border} />
                                            <Text style={styles.aiEmptyText}>No items — all rows removed</Text>
                                        </View>
                                    ) : (
                                        autoImportItems.map((item, idx) => {
                                            if (r.isSmall) {
                                                return (
                                                    <View key={item._key} style={styles.aiCard}>
                                                        <View style={styles.aiCardHeader}>
                                                            <Text style={styles.aiCardIndex}>#{idx + 1}</Text>
                                                            <TouchableOpacity
                                                                onPress={() => removeAutoImportRow(item._key)}
                                                                style={styles.aiRemoveBtnSmall}
                                                            >
                                                                <Ionicons name="trash-outline" size={16} color={COLORS.error} />
                                                            </TouchableOpacity>
                                                        </View>
                                                        <View style={styles.aiCardBody}>
                                                            <View style={styles.aiFieldGroup}>
                                                                <Text style={styles.aiFieldLabel}>Medicine Name *</Text>
                                                                <TextInput
                                                                    style={styles.aiCellInput}
                                                                    value={item.medicine_name}
                                                                    onChangeText={(v) => updateAutoImportRow(item._key, 'medicine_name', v)}
                                                                    placeholder="e.g. Paracetamol"
                                                                />
                                                            </View>
                                                            <View style={styles.aiFieldRow}>
                                                                <View style={{ flex: 1, gap: 4 }}>
                                                                    <Text style={styles.aiFieldLabel}>Qty</Text>
                                                                    <TextInput
                                                                        style={styles.aiCellInput}
                                                                        value={item.quantity}
                                                                        onChangeText={(v) => updateAutoImportRow(item._key, 'quantity', v)}
                                                                        keyboardType="numeric"
                                                                    />
                                                                </View>
                                                                <View style={{ flex: 1, gap: 4 }}>
                                                                    <Text style={styles.aiFieldLabel}>MRP</Text>
                                                                    <TextInput
                                                                        style={styles.aiCellInput}
                                                                        value={item.mrp}
                                                                        onChangeText={(v) => updateAutoImportRow(item._key, 'mrp', v)}
                                                                        keyboardType="numeric"
                                                                    />
                                                                </View>
                                                            </View>
                                                            <View style={styles.aiFieldRow}>
                                                                <View style={{ flex: 1, gap: 4 }}>
                                                                    <Text style={styles.aiFieldLabel}>Cost</Text>
                                                                    <TextInput
                                                                        style={styles.aiCellInput}
                                                                        value={item.cost_price}
                                                                        onChangeText={(v) => updateAutoImportRow(item._key, 'cost_price', v)}
                                                                        keyboardType="numeric"
                                                                    />
                                                                </View>
                                                                <View style={{ flex: 1, gap: 4 }}>
                                                                    <Text style={styles.aiFieldLabel}>Expiry</Text>
                                                                    {Platform.OS === 'web' ? (
                                                                        React.createElement('input', {
                                                                            type: 'date',
                                                                            value: item.expiry_date,
                                                                            onChange: (e) => updateAutoImportRow(item._key, 'expiry_date', e.target.value),
                                                                            style: {
                                                                                width: '100%',
                                                                                height: 40,
                                                                                backgroundColor: COLORS.white,
                                                                                border: `1px solid ${COLORS.border}`,
                                                                                borderRadius: 8,
                                                                                paddingHorizontal: 10,
                                                                                fontSize: 14,
                                                                                fontFamily: 'inherit',
                                                                                outline: 'none',
                                                                                boxSizing: 'border-box'
                                                                            },
                                                                        })
                                                                    ) : (
                                                                        <TextInput
                                                                            style={styles.aiCellInput}
                                                                            value={item.expiry_date}
                                                                            onChangeText={(v) => updateAutoImportRow(item._key, 'expiry_date', v)}
                                                                            placeholder="YYYY-MM-DD"
                                                                        />
                                                                    )}
                                                                </View>
                                                            </View>
                                                            <View style={styles.aiFieldRow}>
                                                                <View style={{ flex: 1, gap: 4 }}>
                                                                    <Text style={styles.aiFieldLabel}>Batch</Text>
                                                                    <TextInput
                                                                        style={styles.aiCellInput}
                                                                        value={item.batch_number}
                                                                        onChangeText={(v) => updateAutoImportRow(item._key, 'batch_number', v)}
                                                                        placeholder="Batch No"
                                                                    />
                                                                </View>
                                                                <View style={{ flex: 1, gap: 4 }}>
                                                                    <Text style={styles.aiFieldLabel}>HSN</Text>
                                                                    <TextInput
                                                                        style={styles.aiCellInput}
                                                                        value={item.hsn_code}
                                                                        onChangeText={(v) => updateAutoImportRow(item._key, 'hsn_code', v)}
                                                                        placeholder="HSN Code"
                                                                    />
                                                                </View>
                                                            </View>
                                                            <View style={styles.aiFieldRow}>
                                                                <View style={{ flex: 1, gap: 4 }}>
                                                                    <Text style={styles.aiFieldLabel}>GST (%)</Text>
                                                                    <TextInput
                                                                        style={styles.aiCellInput}
                                                                        value={item.gst}
                                                                        onChangeText={(v) => updateAutoImportRow(item._key, 'gst', v)}
                                                                        placeholder="0"
                                                                        keyboardType="numeric"
                                                                    />
                                                                </View>
                                                                <View style={{ flex: 2, gap: 4 }}>
                                                                    <Text style={styles.aiFieldLabel}>Supplier</Text>
                                                                    <TextInput
                                                                        style={styles.aiCellInput}
                                                                        value={item.supplier_name}
                                                                        onChangeText={(v) => updateAutoImportRow(item._key, 'supplier_name', v)}
                                                                    />
                                                                </View>
                                                            </View>
                                                        </View>
                                                    </View>
                                                );
                                            }
                                            return (
                                                <View
                                                    key={item._key}
                                                    style={[styles.aiTableRow, idx % 2 === 0 && styles.aiTableRowAlt]}
                                                >
                                                    <View style={[styles.aiTdCell, { flex: 2.0 }]}>
                                                        <TextInput
                                                            style={styles.aiGridInput}
                                                            value={item.medicine_name}
                                                            onChangeText={(v) => updateAutoImportRow(item._key, 'medicine_name', v)}
                                                            placeholder="Medicine name"
                                                            placeholderTextColor={COLORS.textMuted}
                                                        />
                                                    </View>
                                                    <View style={[styles.aiTdCell, { flex: 0.6 }]}>
                                                        <TextInput
                                                            style={styles.aiGridInput}
                                                            value={item.quantity}
                                                            onChangeText={(v) => updateAutoImportRow(item._key, 'quantity', v)}
                                                            placeholder="0"
                                                            placeholderTextColor={COLORS.textMuted}
                                                            keyboardType="numeric"
                                                        />
                                                    </View>
                                                    <View style={[styles.aiTdCell, { flex: 0.7 }]}>
                                                        <TextInput
                                                            style={styles.aiGridInput}
                                                            value={item.mrp}
                                                            onChangeText={(v) => updateAutoImportRow(item._key, 'mrp', v)}
                                                            placeholder="0.00"
                                                            placeholderTextColor={COLORS.textMuted}
                                                            keyboardType="numeric"
                                                        />
                                                    </View>
                                                    <View style={[styles.aiTdCell, { flex: 0.7 }]}>
                                                        <TextInput
                                                            style={styles.aiGridInput}
                                                            value={item.cost_price}
                                                            onChangeText={(v) => updateAutoImportRow(item._key, 'cost_price', v)}
                                                            placeholder="0.00"
                                                            placeholderTextColor={COLORS.textMuted}
                                                            keyboardType="numeric"
                                                        />
                                                    </View>
                                                    <View style={[styles.aiTdCell, { flex: 0.9 }]}>
                                                        <TextInput
                                                            style={styles.aiGridInput}
                                                            value={item.batch_number}
                                                            onChangeText={(v) => updateAutoImportRow(item._key, 'batch_number', v)}
                                                            placeholder="Batch"
                                                            placeholderTextColor={COLORS.textMuted}
                                                        />
                                                    </View>
                                                    <View style={[styles.aiTdCell, { flex: 0.8 }]}>
                                                        <TextInput
                                                            style={styles.aiGridInput}
                                                            value={item.hsn_code}
                                                            onChangeText={(v) => updateAutoImportRow(item._key, 'hsn_code', v)}
                                                            placeholder="HSN"
                                                            placeholderTextColor={COLORS.textMuted}
                                                        />
                                                    </View>
                                                    <View style={[styles.aiTdCell, { flex: 0.6 }]}>
                                                        <TextInput
                                                            style={styles.aiGridInput}
                                                            value={item.gst}
                                                            onChangeText={(v) => updateAutoImportRow(item._key, 'gst', v)}
                                                            placeholder="0"
                                                            placeholderTextColor={COLORS.textMuted}
                                                            keyboardType="numeric"
                                                        />
                                                    </View>
                                                    <View style={[styles.aiTdCell, { flex: 1.2 }]}>
                                                        <TextInput
                                                            style={styles.aiGridInput}
                                                            value={item.supplier_name}
                                                            onChangeText={(v) => updateAutoImportRow(item._key, 'supplier_name', v)}
                                                            placeholder="Supplier"
                                                            placeholderTextColor={COLORS.textMuted}
                                                        />
                                                    </View>
                                                    <View style={[styles.aiTdCell, { flex: 1.1 }]}>
                                                        {Platform.OS === 'web' ? (
                                                            React.createElement('input', {
                                                                type: 'date',
                                                                value: item.expiry_date,
                                                                onChange: (e) => updateAutoImportRow(item._key, 'expiry_date', e.target.value),
                                                                style: {
                                                                    width: '100%',
                                                                    height: '100%',
                                                                    backgroundColor: 'transparent',
                                                                    border: 'none',
                                                                    paddingLeft: 8,
                                                                    paddingRight: 8,
                                                                    fontSize: 12,
                                                                    color: COLORS.textPrimary,
                                                                    fontFamily: 'inherit',
                                                                    outline: 'none',
                                                                    cursor: 'pointer',
                                                                    boxSizing: 'border-box',
                                                                },
                                                            })
                                                        ) : (
                                                            <TextInput
                                                                style={styles.aiGridInput}
                                                                value={item.expiry_date}
                                                                onChangeText={(v) => updateAutoImportRow(item._key, 'expiry_date', v)}
                                                                placeholder="YYYY-MM-DD"
                                                                placeholderTextColor={COLORS.textMuted}
                                                            />
                                                        )}
                                                    </View>
                                                    <View style={[styles.aiTdCell, { flex: 0.4, borderRightWidth: 0, alignItems: 'center', justifyContent: 'center' }]}>
                                                        <TouchableOpacity
                                                            onPress={() => removeAutoImportRow(item._key)}
                                                            style={styles.aiRemoveBtn}
                                                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                                        >
                                                            <Ionicons name="trash-outline" size={16} color={COLORS.error} />
                                                        </TouchableOpacity>
                                                    </View>
                                                </View>
                                            );
                                        })
                                    )}
                                </ScrollView>
                            </View>
                        )}

                        {/* Footer */}
                        <View style={[styles.modalFooter, r.isSmall && { flexDirection: 'column-reverse', alignItems: 'stretch' }]}>
                            <TouchableOpacity style={[styles.aiCancelBtn, r.isSmall && { height: 44, marginTop: 8 }]} onPress={closeAutoImportReview}>
                                <Text style={styles.aiCancelBtnText}>Cancel</Text>
                            </TouchableOpacity>
                            <GradientButton
                                title={autoImportConfirming ? 'Importing...' : `Confirm Import (${autoImportItems.length})`}
                                onPress={handleConfirmAutoImport}
                                loading={autoImportConfirming}
                                disabled={autoImportItems.length === 0 || autoImportConfirming}
                                icon={<Ionicons name="checkmark-circle-outline" size={20} color={COLORS.white} />}
                                style={r.isSmall ? { height: 44 } : { flex: 2 }}
                            />
                        </View>
                    </View>
                </View>
            </Modal>



            {/* ─── UNDER DEV MODAL ─── */}
            {/* Batch Conflict Resolution Modal */}
            <Modal visible={conflictModalVisible} animationType="fade" transparent>
                <View style={styles.modalOverlay}>
                    <View style={[styles.labelModalCard, { width: r.pick({ small: '95%', medium: 500, large: 500, xlarge: 500 }) }]}>
                        <View style={styles.modalHeader}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#fef2f2', justifyContent: 'center', alignItems: 'center' }}>
                                    <Ionicons name="warning" size={18} color={COLORS.error} />
                                </View>
                                <Text style={styles.modalTitle}>Batch Conflict Detected</Text>
                            </View>
                            <TouchableOpacity onPress={() => setConflictModalVisible(false)} style={styles.modalCloseBtn}>
                                <Ionicons name="close" size={24} color={COLORS.textMuted} />
                            </TouchableOpacity>
                        </View>

                        {batchConflicts.length > 0 && (
                            <View style={{ padding: SPACING.lg }}>
                                <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 15 }}>
                                    A batch with the same number already exists for <Text style={{ fontWeight: '700', color: COLORS.textPrimary }}>{batchConflicts[0].payload.medicine_name}</Text>, but the details differ.
                                </Text>

                                <View style={{ flexDirection: 'row', gap: 15 }}>
                                    {/* Existing Batch */}
                                    <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: 15, borderRadius: RADIUS.md, borderWidth: 1, borderColor: '#e2e8f0' }}>
                                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b', marginBottom: 10 }}>EXISTING BATCH IN SYSTEM</Text>
                                        <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 5 }}>Batch No: <Text style={{ color: COLORS.textPrimary, fontWeight: '500' }}>{batchConflicts[0].conflictData.batch_number || 'None'}</Text></Text>
                                        
                                        <Text style={{ fontSize: 13, color: batchConflicts[0].conflictData.conflict_fields.includes('mrp') ? COLORS.error : COLORS.textSecondary, marginBottom: 5, fontWeight: batchConflicts[0].conflictData.conflict_fields.includes('mrp') ? '700' : '400' }}>
                                            MRP: ₹{batchConflicts[0].conflictData.existing_mrp}
                                        </Text>
                                        
                                        <Text style={{ fontSize: 13, color: batchConflicts[0].conflictData.conflict_fields.includes('expiry_date') ? COLORS.error : COLORS.textSecondary, fontWeight: batchConflicts[0].conflictData.conflict_fields.includes('expiry_date') ? '700' : '400' }}>
                                            Expiry: {batchConflicts[0].conflictData.existing_expiry || 'None'}
                                        </Text>
                                    </View>

                                    {/* Incoming Batch */}
                                    <View style={{ flex: 1, backgroundColor: '#f0fdf4', padding: 15, borderRadius: RADIUS.md, borderWidth: 1, borderColor: '#bbf7d0' }}>
                                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#16a34a', marginBottom: 10 }}>INCOMING BATCH</Text>
                                        <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 5 }}>Batch No: <Text style={{ color: COLORS.textPrimary, fontWeight: '500' }}>{batchConflicts[0].payload.batch_number || 'None'}</Text></Text>
                                        
                                        <Text style={{ fontSize: 13, color: batchConflicts[0].conflictData.conflict_fields.includes('mrp') ? COLORS.error : COLORS.textSecondary, marginBottom: 5, fontWeight: batchConflicts[0].conflictData.conflict_fields.includes('mrp') ? '700' : '400' }}>
                                            MRP: ₹{batchConflicts[0].conflictData.incoming_mrp}
                                        </Text>
                                        
                                        <Text style={{ fontSize: 13, color: batchConflicts[0].conflictData.conflict_fields.includes('expiry_date') ? COLORS.error : COLORS.textSecondary, fontWeight: batchConflicts[0].conflictData.conflict_fields.includes('expiry_date') ? '700' : '400' }}>
                                            Expiry: {batchConflicts[0].conflictData.incoming_expiry || 'None'}
                                        </Text>
                                    </View>
                                </View>

                                <View style={{ marginTop: 25, gap: 10 }}>
                                    <TouchableOpacity 
                                        style={{ backgroundColor: COLORS.primary, padding: 12, borderRadius: RADIUS.md, alignItems: 'center' }}
                                        onPress={() => resolveConflict('force_update')}
                                    >
                                        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>Force Update & Merge</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity 
                                        style={{ backgroundColor: '#fff', padding: 12, borderRadius: RADIUS.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }}
                                        onPress={() => resolveConflict('isolate')}
                                    >
                                        <Text style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: '600' }}>Isolate as New Batch</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity 
                                        style={{ padding: 12, alignItems: 'center' }}
                                        onPress={() => {
                                            const remaining = batchConflicts.slice(1);
                                            setBatchConflicts(remaining);
                                            if (remaining.length === 0) setConflictModalVisible(false);
                                        }}
                                    >
                                        <Text style={{ color: COLORS.textMuted, fontSize: 13, fontWeight: '500' }}>Skip</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
                    </View>
                </View>
            </Modal>

            <Modal visible={devModalVisible} animationType="fade" transparent>
                <View style={styles.modalOverlay}>
                    <View style={[styles.labelModalCard, { width: r.pick({ small: '95%', medium: 450, large: 450, xlarge: 450 }) }]}>
                        {/* Header */}
                        <View style={styles.modalHeader}>
                            <View style={styles.modalHeaderLeft}>
                                <View style={[styles.modalIcon, { backgroundColor: COLORS.warningLight }]}>
                                    <Ionicons name="construct-outline" size={22} color={COLORS.warning} />
                                </View>
                                <View>
                                    <Text style={styles.modalTitle}>Under Development</Text>
                                    <Text style={styles.labelModalSub}>
                                        Feature unavailable
                                    </Text>
                                </View>
                            </View>
                            <TouchableOpacity onPress={() => setDevModalVisible(false)} style={styles.modalCloseBtn}>
                                <Ionicons name="close" size={24} color={COLORS.textMuted} />
                            </TouchableOpacity>
                        </View>

                        {/* Body */}
                        <View style={{ padding: 40, alignItems: 'center' }}>
                            <Ionicons name="time-outline" size={48} color={COLORS.border} style={{ marginBottom: 16 }} />
                            <Text style={{ fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 }}>
                                This feature is currently under development and will be available in a future update!
                            </Text>
                        </View>

                        {/* Footer */}
                        <View style={{ flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: COLORS.border }}>
                            <GradientButton
                                title="Close"
                                variant="secondary"
                                onPress={() => setDevModalVisible(false)}
                                style={{ flex: 1 }}
                            />
                        </View>
                    </View>
                </View>
            </Modal>

            <Modal visible={autoImportNoticeVisible} animationType="fade" transparent>
                <View style={styles.modalOverlay}>
                    <View style={[styles.labelModalCard, { width: r.pick({ small: '95%', medium: 450, large: 500, xlarge: 500 }) }]}>
                        {/* Header */}
                        <View style={styles.modalHeader}>
                            <View style={styles.modalHeaderLeft}>
                                <View style={[styles.modalIcon, { backgroundColor: COLORS.warningLight }]}>
                                    <Ionicons name="information-circle-outline" size={22} color={COLORS.warning} />
                                </View>
                                <View>
                                    <Text style={styles.modalTitle}>Notice</Text>
                                    <Text style={styles.labelModalSub}>
                                        Auto Import Unavailable
                                    </Text>
                                </View>
                            </View>
                            <TouchableOpacity onPress={() => setAutoImportNoticeVisible(false)} style={styles.modalCloseBtn}>
                                <Ionicons name="close" size={24} color={COLORS.textMuted} />
                            </TouchableOpacity>
                        </View>

                        {/* Body */}
                        <View style={{ padding: 24 }}>
                            <Text style={{ fontSize: 15, color: COLORS.text, lineHeight: 24 }}>
                                We're very sorry for the inconvenience. The auto bill import feature is under maintanence. It will be available from 29.06.26.
                            </Text>
                            <Text style={{ fontSize: 15, color: COLORS.text, lineHeight: 24, marginTop: 12 }}>
                                Please send the bill images via whatsapp to this number - <Text style={{ fontWeight: '700', color: COLORS.primary }}>8101402916</Text>. We will take care of the purchase entry and stock update till the feature is available.
                            </Text>
                            <Text style={{ fontSize: 15, color: COLORS.text, lineHeight: 24, marginTop: 12, fontWeight: '600' }}>
                                OR, You can still add your bill through manual entry.
                            </Text>
                        </View>

                        {/* Footer */}
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: 24, paddingTop: 0, gap: 12 }}>
                            <TouchableOpacity
                                style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border }}
                                onPress={() => setAutoImportNoticeVisible(false)}
                            >
                                <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>Close</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, backgroundColor: COLORS.primary }}
                                onPress={() => {
                                    setAutoImportNoticeVisible(false);
                                    navigation.navigate('Purchase', { openAddModal: true });
                                }}
                            >
                                <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.white }}>Manual Purchase Upload</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ─── SUCCESS TOAST ─── */}
            {toastVisible && (
                <View style={styles.toastContainer} pointerEvents="none">
                    <View style={styles.toastBox}>
                        <Ionicons name="checkmark-circle" size={22} color={COLORS.white} />
                        <Text style={styles.toastText}>{toastMessage}</Text>
                    </View>
                </View>
            )}
        </View>

    );
}

// ─── STYLES ─────────────────────────────────────
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.bgDark,
    },

    // Header (Light theme matching POS screen)
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: SPACING.lg,
        paddingVertical: 10,
        backgroundColor: COLORS.bgSurface,
        height: 52,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
    },
    headerTitle: { fontSize: 16, fontWeight: '400', color: COLORS.textPrimary },
    headerSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    actionHeaderBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 2,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        backgroundColor: COLORS.white,
        justifyContent: 'center',
    },
    actionHeaderBtnText: {
        fontSize: 12,
        fontWeight: '600',
        color: COLORS.textSecondary,
    },
    actionHeaderBtnPrimary: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 2,
        backgroundColor: COLORS.primary,
        borderWidth: 0.5,
        borderColor: COLORS.primary,
        justifyContent: 'center',
    },
    actionHeaderBtnPrimaryText: {
        fontSize: 12,
        fontWeight: '600',
        color: COLORS.white,
    },

    // Filter Bar / Toolbar Row
    filterBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: SPACING.lg,
        paddingVertical: 4,
        backgroundColor: COLORS.white,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderLight,
        gap: SPACING.md,
    },
    filterBarMobile: {
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: SPACING.sm,
        paddingHorizontal: SPACING.md,
        paddingVertical: SPACING.sm,
    },
    filterTabs: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.md,
    },
    filterTab: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.xs,
        paddingVertical: 8,
        paddingHorizontal: 4,
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    filterTabActive: {
        borderBottomColor: COLORS.primary,
    },
    filterTabText: {
        fontSize: FONT_SIZES.sm,
        fontWeight: '500',
        color: COLORS.textMuted,
    },
    filterTabTextActive: {
        color: COLORS.primary,
    },
    filterTabBadge: {
        borderRadius: 4,
        paddingHorizontal: 6,
        paddingVertical: 1,
        marginLeft: 4,
        alignItems: 'center',
        justifyContent: 'center',
    },
    filterTabBadgeDanger: {
        backgroundColor: COLORS.error,
    },
    filterTabBadgeWarning: {
        backgroundColor: COLORS.warning,
    },
    filterTabBadgeText: {
        fontSize: 11,
        fontWeight: '500',
        color: COLORS.white,
    },
    filterTabBadgeTextDanger: {
        color: COLORS.white,
    },
    filterTabBadgeTextWarning: {
        color: COLORS.white,
    },
    filterBarRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.md,
        flexWrap: 'wrap',
    },
    searchContainerMobile: {
        width: '100%',
        marginTop: SPACING.xs,
    },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.bgInput,
        borderRadius: 3,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        paddingHorizontal: SPACING.md,
        height: 32,
        minWidth: 240,
        gap: SPACING.sm,
    },
    searchInput: {
        flex: 1,
        fontSize: FONT_SIZES.sm,
        color: COLORS.textPrimary,
        fontWeight: '400',
    },

    // Table
    tableContainer: {
        flex: 1,
        marginHorizontal: SPACING.lg,
        marginTop: 8,
        backgroundColor: COLORS.white,
        borderRadius: 2,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        overflow: 'hidden',
    },
    tableHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.borderLight,
        height: 28,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
    },
    th: {
        fontSize: 11,
        fontWeight: '700',
        color: COLORS.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    thCell: {
        justifyContent: 'center',
        paddingHorizontal: 8,
        height: '100%',
        borderRightWidth: 0.5,
        borderRightColor: COLORS.border,
    },
    tableRow: {
        flexDirection: 'row',
        alignItems: 'stretch',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
        backgroundColor: COLORS.white,
        height: 46,
    },
    tdCell: {
        justifyContent: 'center',
        paddingHorizontal: 8,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.border,
    },
    cell: {
        paddingRight: SPACING.sm,
    },
    cellName: {
        fontSize: 13,
        fontWeight: '500',
        color: COLORS.textPrimary,
        marginBottom: 2,
    },
    cellSub: {
        fontSize: 10,
        color: COLORS.textMuted,
        fontWeight: '500',
    },
    cellText: {
        fontSize: 12,
        color: COLORS.textSecondary,
        fontWeight: '500',
    },
    cellPrice: {
        fontSize: 13,
        fontWeight: '500',
        color: COLORS.textPrimary,
    },
    actionsCell: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: SPACING.sm,
    },
    actionBtn: {
        width: 26,
        height: 26,
        borderRadius: 2,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        backgroundColor: COLORS.bgInput,
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionBtnDanger: {
        borderColor: COLORS.errorLight,
        backgroundColor: COLORS.errorLight,
    },
    centerBox: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: SPACING.xxxl,
        gap: SPACING.sm,
        opacity: 0.20,
    },
    emptyText: {
        fontSize: FONT_SIZES.lg,
        color: COLORS.textMuted,
        fontWeight: '500',
    },

    // Badges / Tags
    outOfStockTag: {
        backgroundColor: COLORS.errorLight,
        borderColor: COLORS.error,
        borderWidth: 0.5,
        borderRadius: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    outOfStockTagText: {
        color: COLORS.error,
        fontSize: 12,
        fontWeight: '500',
    },
    lowStockTag: {
        backgroundColor: COLORS.warningLight,
        borderColor: COLORS.warning,
        borderWidth: 0.5,
        borderRadius: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    lowStockTagText: {
        color: COLORS.warning,
        fontSize: 12,
        fontWeight: '500',
    },

    // ─── MODAL ────────────────────────────
    modalOverlay: {
        flex: 1,
        backgroundColor: COLORS.overlay,
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalCard: {
        maxWidth: 700,
        maxHeight: '85%',
        backgroundColor: COLORS.white,
        borderRadius: 5,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        overflow: 'hidden',
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: SPACING.xl,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
    },
    modalHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.md,
    },
    modalIcon: {
        width: 36,
        height: 36,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: COLORS.textPrimary,
        textTransform: 'uppercase',
    },
    modalCloseBtn: {
        width: 32,
        height: 32,
        borderRadius: 4,
        backgroundColor: COLORS.bgSurface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalBody: {
        maxHeight: 400,
    },
    modalBodyContent: {
        padding: SPACING.xl,
    },
    detailsContainer: {
        flexDirection: 'column',
        gap: SPACING.md,
    },
    detailCard: {
        backgroundColor: COLORS.bgInput,
        borderRadius: 5,
        padding: SPACING.lg,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        marginBottom: SPACING.sm,
    },
    detailSectionTitle: {
        fontSize: FONT_SIZES.sm,
        fontWeight: '500',
        color: COLORS.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: SPACING.md,
    },
    detailRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: SPACING.md,
        gap: SPACING.lg,
    },
    detailItem: {
        flex: 1,
        minWidth: 120,
    },
    detailLabel: {
        fontSize: FONT_SIZES.xs,
        color: COLORS.textMuted,
        marginBottom: 4,
    },
    detailValue: {
        fontSize: FONT_SIZES.md,
        color: COLORS.textPrimary,
        fontWeight: '500',
    },
    modalFooter: {
        flexDirection: 'row',
        gap: SPACING.md,
        padding: SPACING.xl,
        borderTopWidth: 0.5,
        borderTopColor: COLORS.border,
    },

    // Form Grid / Fields
    formGrid: {
        gap: SPACING.md,
    },
    formRow: {
        flexDirection: 'row',
        gap: SPACING.md,
    },
    fieldContainer: {
        marginBottom: SPACING.sm,
    },
    fieldLabel: {
        fontSize: 11,
        fontWeight: '500',
        color: COLORS.textSecondary,
        textTransform: 'uppercase',
        marginBottom: 4,
    },
    fieldInput: {
        backgroundColor: COLORS.bgInput,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        borderRadius: 2,
        paddingHorizontal: 8,
        paddingVertical: 0,
        fontSize: 12,
        color: COLORS.textPrimary,
        height: 34,
        justifyContent: 'center',
        ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
    },
    fieldInputMultiline: {
        minHeight: 60,
        paddingVertical: 6,
        textAlignVertical: 'top',
    },
    fieldInputDisabled: {
        backgroundColor: COLORS.bgSurface,
        color: COLORS.textMuted,
    },

    // Delete Modal
    deleteModal: {
        backgroundColor: COLORS.white,
        borderRadius: 5,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        padding: SPACING.xxl,
        alignItems: 'center',
    },
    deleteIconBox: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: COLORS.errorLight,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: SPACING.lg,
    },
    deleteTitle: {
        fontSize: FONT_SIZES.xl,
        fontWeight: '500',
        color: COLORS.textPrimary,
        marginBottom: SPACING.sm,
    },
    deleteDesc: {
        fontSize: FONT_SIZES.md,
        color: COLORS.textSecondary,
        textAlign: 'center',
        lineHeight: 24,
        marginBottom: SPACING.xl,
    },
    deleteActions: {
        flexDirection: 'row',
        gap: SPACING.md,
        width: '100%',
    },

    // Labels Modal
    labelModalCard: {
        maxWidth: 750,
        maxHeight: '88%',
        backgroundColor: COLORS.white,
        borderRadius: 5,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        overflow: 'hidden',
    },
    checkbox: {
        width: 20,
        height: 20,
        borderRadius: 3,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: COLORS.white,
    },
    checkboxChecked: {
        backgroundColor: COLORS.primary,
        borderColor: COLORS.primary,
    },
    labelModalSub: {
        fontSize: FONT_SIZES.xs,
        color: COLORS.textMuted,
        marginTop: 2,
    },
    labelAlphabetBox: {
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
        paddingVertical: 8,
        backgroundColor: COLORS.bgSurface,
    },
    alphabetBtn: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: COLORS.bgInput,
        borderWidth: 0.5,
        borderColor: COLORS.border,
    },
    alphabetBtnActive: {
        backgroundColor: COLORS.primary,
        borderColor: COLORS.primary,
    },
    alphabetBtnText: {
        fontSize: 12,
        color: COLORS.textMuted,
        fontWeight: '500',
    },
    alphabetBtnTextActive: {
        color: COLORS.white,
    },
    labelSearchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.bgInput,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
        paddingHorizontal: SPACING.lg,
        height: 38,
        gap: SPACING.sm,
    },
    labelSearchInput: {
        flex: 1,
        fontSize: 12,
        height: '100%',
        paddingVertical: 0,
        color: COLORS.textPrimary,
        ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
    },
    labelList: {
        maxHeight: 400,
    },
    labelEmptyBox: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: SPACING.xxxl,
        gap: SPACING.sm,
    },
    labelEmptyText: {
        fontSize: FONT_SIZES.md,
        color: COLORS.textMuted,
    },
    labelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: SPACING.md,
        paddingHorizontal: SPACING.lg,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderLight,
        minHeight: 62,
    },
    labelRowSelected: {
        backgroundColor: COLORS.primaryGhost,
    },
    labelRowLeft: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.md,
    },
    labelProductName: {
        fontSize: FONT_SIZES.md,
        fontWeight: '500',
        color: COLORS.textPrimary,
        marginBottom: 2,
    },
    labelProductSub: {
        fontSize: FONT_SIZES.xs,
        color: COLORS.textMuted,
    },
    labelCopiesBox: {
        alignItems: 'center',
        marginLeft: SPACING.md,
    },
    labelCopiesLabel: {
        fontSize: 11,
        fontWeight: '500',
        color: COLORS.textMuted,
        marginBottom: 4,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    labelCopiesInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.bgInput,
        borderRadius: 4,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        overflow: 'hidden',
    },
    labelCopiesStepBtn: {
        width: 32,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: COLORS.bgSurface,
    },
    labelCopiesInput: {
        width: 42,
        height: 34,
        textAlign: 'center',
        fontSize: FONT_SIZES.sm,
        fontWeight: '500',
        color: COLORS.textPrimary,
        paddingVertical: 0,
    },

    // Auto Import Modal
    autoImportModalCard: {
        maxWidth: 860,
        maxHeight: '90%',
        backgroundColor: COLORS.white,
        borderRadius: 5,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        overflow: 'hidden',
    },
    autoImportSubtitle: {
        fontSize: FONT_SIZES.xs,
        color: COLORS.textMuted,
        marginTop: 2,
    },
    aiTableContainer: {
        marginHorizontal: SPACING.xl,
        marginVertical: SPACING.md,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        borderRadius: 2,
        backgroundColor: COLORS.white,
        overflow: 'hidden',
    },
    aiTableHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.borderLight,
        height: 32,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
    },
    aiThCell: {
        justifyContent: 'center',
        height: '100%',
        borderRightWidth: 0.5,
        borderRightColor: COLORS.border,
    },
    aiTh: {
        fontSize: 11,
        fontWeight: '700',
        color: COLORS.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        paddingHorizontal: 8,
    },
    aiTableBody: {
        maxHeight: 380,
    },
    aiTableRow: {
        flexDirection: 'row',
        alignItems: 'stretch',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
        backgroundColor: COLORS.white,
        height: 38,
    },
    aiTableRowAlt: {
        backgroundColor: COLORS.bgInput,
    },
    aiTdCell: {
        justifyContent: 'center',
        borderRightWidth: 0.5,
        borderRightColor: COLORS.border,
        paddingHorizontal: 0,
    },
    aiGridInput: {
        flex: 1,
        height: '100%',
        paddingHorizontal: 8,
        fontSize: 12,
        color: COLORS.textPrimary,
        backgroundColor: 'transparent',
        borderWidth: 0,
        outlineWidth: 0,
    },
    aiCellInput: {
        backgroundColor: COLORS.white,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        borderRadius: 2,
        paddingHorizontal: 6,
        paddingVertical: 0,
        fontSize: 12,
        color: COLORS.textPrimary,
        height: 32,
        ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
    },
    aiRemoveBtn: {
        width: 24,
        height: 24,
        borderRadius: 2,
        backgroundColor: COLORS.errorLight,
        alignItems: 'center',
        justifyContent: 'center',
    },
    aiEmptyBox: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: SPACING.xxxl,
        gap: SPACING.sm,
    },
    aiEmptyText: {
        fontSize: FONT_SIZES.md,
        color: COLORS.textMuted,
        fontWeight: '500',
    },
    aiErrorBanner: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: SPACING.sm,
        backgroundColor: COLORS.warningLight,
        borderLeftWidth: 3,
        borderLeftColor: COLORS.warning,
        marginHorizontal: SPACING.lg,
        marginTop: SPACING.md,
        marginBottom: SPACING.sm,
        borderRadius: 4,
        padding: SPACING.md,
    },
    aiErrorText: {
        flex: 1,
        fontSize: FONT_SIZES.sm,
        color: COLORS.warning,
        lineHeight: 20,
    },
    aiCancelBtn: {
        flex: 1,
        height: 48,
        borderRadius: 5,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: COLORS.bgSurface,
    },
    aiCancelBtnText: {
        fontSize: FONT_SIZES.sm,
        fontWeight: '500',
        color: COLORS.textSecondary,
    },

    // ─── TOAST ───────────────────────────────────
    toastContainer: {
        position: 'absolute',
        bottom: 40,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 9999,
    },
    toastBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.sm,
        backgroundColor: COLORS.success,
        paddingHorizontal: SPACING.xl,
        paddingVertical: SPACING.md,
        borderRadius: 5,
        borderWidth: 0.5,
        borderColor: COLORS.primaryDark,
    },
    toastText: {
        fontSize: FONT_SIZES.sm,
        fontWeight: '500',
        color: COLORS.white,
    },

    // Auto Import Responsive Cards
    aiCard: {
        backgroundColor: COLORS.white,
        borderRadius: 4,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        marginVertical: SPACING.sm,
        padding: SPACING.md,
    },
    aiCardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderLight,
        paddingBottom: SPACING.sm,
        marginBottom: SPACING.md,
    },
    aiCardIndex: {
        fontSize: 12,
        fontWeight: '500',
        color: COLORS.white,
        backgroundColor: COLORS.primary,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 3,
    },
    aiRemoveBtnSmall: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: COLORS.errorLight,
        alignItems: 'center',
        justifyContent: 'center',
    },
    aiCardBody: {
        gap: SPACING.md,
    },
    aiFieldRow: {
        flexDirection: 'row',
        gap: SPACING.md,
    },
    aiFieldGroup: {
        gap: 4,
    },
    aiFieldLabel: {
        fontSize: 11,
        fontWeight: '500',
        color: COLORS.textMuted,
        textTransform: 'uppercase',
    },

    // Mobile Card (Responsive)
    mobileCard: {
        backgroundColor: COLORS.white,
        borderRadius: 5,
        marginHorizontal: 8,
        marginVertical: 6,
        padding: 12,
        borderWidth: 0.5,
        borderColor: COLORS.borderLight,
    },
    mobileCardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 10,
    },
    mobileCardPriceBox: {
        backgroundColor: COLORS.primaryGhost,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
    },
    mobileCardBody: {
        flexDirection: 'row',
        backgroundColor: COLORS.bgSurface,
        borderRadius: 4,
        padding: 10,
        marginBottom: 12,
        gap: 20,
    },
    mobileCardStat: {
        flex: 1,
    },
    mobileStatLabel: {
        fontSize: 10,
        color: COLORS.textMuted,
        textTransform: 'uppercase',
        fontWeight: '500',
        marginBottom: 2,
    },
    mobileStatValue: {
        fontSize: 13,
        fontWeight: '500',
        color: COLORS.textPrimary,
    },
    mobileCardFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 10,
        borderTopWidth: 0.5,
        borderTopColor: COLORS.borderLight,
    },
    mobileActionGroup: {
        flexDirection: 'row',
        gap: 16,
    },
    mobileActionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 8,
    },
    mobileActionText: {
        fontSize: 12,
        fontWeight: '500',
        color: COLORS.textSecondary,
    },
});



