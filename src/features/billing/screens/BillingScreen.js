import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useHotkeys } from 'react-hotkeys-hook'
import {
    View,
    Text,
    FlatList,
    StyleSheet,
    ActivityIndicator,
    Alert,
    TouchableOpacity,
    TextInput,
    ScrollView,
    Platform,
    Modal,
    Dimensions,
    Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT_SIZES, RADIUS, SPACING, SHADOWS } from '../../../core/constants/theme';
import { searchProducts, processCheckout, updateCheckout, getRecentSales } from '../services/billingService';
import { searchCustomer, getCustomerLastPurchase, getCustomerCredit, payCustomerDue } from '../../customer/services/customerService';
import { getProducts, getProductById, createProduct, getLoosePrice } from '../../inventory/services/inventoryService';
import MemoryCache from '../../../core/services/cacheService';
import { printReceipt } from '../../../core/utils/printReceipt';
import { useResponsive } from '../../../core/utils/responsive';
import api from '../../../core/services/api';
import RecommendationWidget from '../components/RecommendationWidget';

// Helper to format expiry date safely and compactly
const formatExpiryDate = (dateStr) => {
    if (!dateStr || dateStr === 'N/A') return 'N/A';
    if (/^\d{2}\/\d{2,4}$/.test(dateStr)) return dateStr;
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    } catch (e) {
        return dateStr;
    }
};

// Numpad Modal
const NumpadModal = React.memo(function NumpadModal({ visible, onClose, onConfirm, title, subtitle, unit, allowDecimal = false, maxValue = 9999 }) {
    const [value, setValue] = useState('');
    const inputRef = useRef(null);

    // Auto-focus when modal opens
    React.useEffect(() => {
        if (visible) {
            setValue('');
            const timeOut = setTimeout(() => inputRef.current?.focus(), 100);
            return () => clearTimeout(timeOut);
        }
    }, [visible]);


    const handleChangeText = (text) => {
        // Allow only valid numeric input
        const cleaned = allowDecimal
            ? text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')   // one dot only
            : text.replace(/[^0-9]/g, '');
        const num = parseFloat(cleaned);
        if (cleaned === '' || cleaned === '.') { setValue(cleaned); return; }
        if (!isNaN(num) && num <= maxValue) setValue(cleaned);
    };

    const handleConfirm = () => {
        const num = parseFloat(value);
        if (!isNaN(num) && num >= 0) onConfirm(num);
        setValue('');
    };

    const handleClose = () => {
        setValue('');
        onClose();
    };

    const isValid = value !== '' && !isNaN(parseFloat(value)) && parseFloat(value) >= 0;

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
            <View style={npStyles.overlay}>
                <View style={npStyles.container}>
                    {/* Header */}
                    <View style={npStyles.header}>
                        <View style={{ flex: 1 }}>
                            <Text style={npStyles.title}>{title || 'Enter Value'}</Text>
                            {subtitle ? <Text style={npStyles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
                        </View>
                        <TouchableOpacity onPress={handleClose} style={npStyles.closeBtn}>
                            <Ionicons name="close" size={22} color={COLORS.textMuted} />
                        </TouchableOpacity>
                    </View>

                    {/* Input field */}
                    <View style={npStyles.inputSection}>
                        <View style={npStyles.inputRow}>
                            <TextInput
                                ref={inputRef}
                                style={npStyles.textInput}
                                value={value}
                                onChangeText={handleChangeText}
                                placeholder="0"
                                placeholderTextColor={COLORS.textMuted}
                                keyboardType={allowDecimal ? 'decimal-pad' : 'number-pad'}
                                returnKeyType="done"
                                onSubmitEditing={isValid ? handleConfirm : undefined}
                                selectTextOnFocus
                                autoFocus
                            />
                            {unit ? <Text style={npStyles.unitLabel}>{unit}</Text> : null}
                        </View>
                        {maxValue < 9999 && (
                            <Text style={npStyles.limitHint}>Max: {maxValue}</Text>
                        )}
                    </View>

                    {/* Actions */}
                    <View style={npStyles.actions}>
                        <TouchableOpacity style={npStyles.cancelBtn} onPress={handleClose} activeOpacity={0.7}>
                            <Text style={npStyles.cancelText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[npStyles.confirmBtn, !isValid && npStyles.confirmDisabled]}
                            onPress={handleConfirm}
                            disabled={!isValid}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="checkmark" size={22} color="#fff" />
                            <Text style={npStyles.confirmText}>Confirm</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
});

const npStyles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: COLORS.overlay,
        alignItems: 'center',
        justifyContent: 'center',
    },
    container: {
        width: Math.min(340, Dimensions.get('window').width * 0.85),
        maxWidth: 400,
        backgroundColor: COLORS.white,
        borderRadius: RADIUS.lg,
        overflow: 'hidden',
        ...SHADOWS.lg,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: SPACING.lg,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderLight,
    },
    title: {
        fontSize: FONT_SIZES.lg,
        fontWeight: '500',
        color: COLORS.textPrimary,
    },
    subtitle: {
        fontSize: FONT_SIZES.sm,
        color: COLORS.textMuted,
        marginTop: 2,
    },
    closeBtn: {
        width: 36,
        height: 36,
        borderRadius: RADIUS.lg,
        backgroundColor: COLORS.bgSurface,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: SPACING.sm,
    },
    inputSection: {
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.xl,
        backgroundColor: COLORS.bgSurface,
        alignItems: 'center',
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.white,
        borderWidth: 0.5,
        borderColor: COLORS.primary,
        borderRadius: RADIUS.lg,
        paddingHorizontal: SPACING.md,
        width: '100%',
    },
    textInput: {
        flex: 1,
        fontSize: 36,
        fontWeight: '500',
        color: COLORS.primary,
        paddingVertical: SPACING.md,
        textAlign: 'center',
        outlineStyle: 'none',
    },
    unitLabel: {
        fontSize: FONT_SIZES.lg,
        fontWeight: '500',
        color: COLORS.textMuted,
        marginLeft: 4,
    },
    limitHint: {
        marginTop: 6,
        fontSize: FONT_SIZES.xs,
        color: COLORS.textMuted,
    },
    actions: {
        flexDirection: 'row',
        padding: SPACING.md,
        gap: SPACING.sm,
        borderTopWidth: 0.5,
        borderTopColor: COLORS.borderLight,
    },
    cancelBtn: {
        flex: 1,
        paddingVertical: SPACING.md,
        borderRadius: RADIUS.md,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelText: {
        fontSize: FONT_SIZES.md,
        fontWeight: '500',
        color: COLORS.textSecondary,
    },
    confirmBtn: {
        flex: 2,
        flexDirection: 'row',
        paddingVertical: SPACING.md,
        borderRadius: RADIUS.md,
        backgroundColor: COLORS.primary,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    confirmDisabled: {
        backgroundColor: COLORS.border,
    },
    confirmText: {
        fontSize: FONT_SIZES.md,
        fontWeight: '500',
        color: '#fff',
    },
});

// ═══════════════════════════════════════════════
// PAYMENT MODAL — collects cash received, handles credit/due
// ═══════════════════════════════════════════════
const PaymentModal = React.memo(function PaymentModal({ visible, onClose, onConfirm, grandTotal, customerCredit = 0, customerName = '' }) {
    const [receivedStr, setReceivedStr] = useState('');
    const [addedDueStr, setAddedDueStr] = useState('');
    const receivedRef = useRef(null);
    const dueRef = useRef(null);

    // Reset whenever modal opens and auto-focus received field
    React.useEffect(() => {
        if (visible) {
            setReceivedStr('');
            setAddedDueStr('');
            const timeout = setTimeout(() => receivedRef.current?.focus(), 150);
            return () => clearTimeout(timeout);
        }
    }, [visible]);

    const previousDueAdded = parseFloat(addedDueStr) || 0;
    const effectiveTotal = grandTotal + previousDueAdded;
    const receivedNum = parseFloat(receivedStr) || 0;
    const change = receivedNum - effectiveTotal;
    const due = effectiveTotal - receivedNum;

    // Allow confirming with 0 received (full due) or any non-negative amount
    // User must explicitly type a value (empty field doesn't count)
    // Payments above effectiveTotal are valid — the customer gets change back
    const canConfirm =
        effectiveTotal === 0 ||
        (receivedStr !== '' && receivedNum >= 0);

    const handleReceivedChange = (text) => {
        const cleaned = text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
        setReceivedStr(cleaned);
    };

    const handleDueChange = (text) => {
        const cleaned = text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
        const num = parseFloat(cleaned);
        if (cleaned === '' || cleaned === '.') { setAddedDueStr(cleaned); return; }
        if (!isNaN(num) && num <= customerCredit) setAddedDueStr(cleaned);
        else if (!isNaN(num) && num > customerCredit) setAddedDueStr(customerCredit.toString());
    };

    const handleConfirm = () => {
        onConfirm({
            amount_paid: receivedNum,
            previous_due_payment: previousDueAdded,
            due_amount: Math.max(0, due),
            change_amount: Math.max(0, change),
        });
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={pmStyles.overlay}>
                <View style={[pmStyles.container, { paddingBottom: 6 }]}>

                    {/* Header */}
                    <View style={pmStyles.header}>
                        <View style={{ flex: 1 }}>
                            <Text style={pmStyles.headerTitle}>Collect Payment</Text>
                            {customerName ? (
                                <Text style={pmStyles.headerSub}>
                                    {customerName} <Text style={{ fontWeight: '700', color: COLORS.error }}>• Prev Due: ₹{customerCredit.toFixed(2)}</Text>
                                </Text>
                            ) : null}
                        </View>
                        <TouchableOpacity onPress={onClose} style={pmStyles.closeBtn}>
                            <Ionicons name="close" size={22} color={COLORS.textMuted} />
                        </TouchableOpacity>
                    </View>

                    <ScrollView contentContainerStyle={{ paddingBottom: 10 }} bouncing={false} showsVerticalScrollIndicator={false}>
                        {/* Grand Total Strip */}
                        <View style={pmStyles.totalStrip}>
                            <View style={pmStyles.totalStripItem}>
                                <Text style={pmStyles.stripLabel}>Current Bill</Text>
                                <Text style={pmStyles.stripValue}>₹{grandTotal.toFixed(2)}</Text>
                            </View>
                            <View style={[pmStyles.totalStripItem, pmStyles.totalStripMid]}>
                                <Text style={pmStyles.stripLabel}>Added Due</Text>
                                <Text style={[pmStyles.stripValue, previousDueAdded > 0 && { color: COLORS.error }]}>+₹{previousDueAdded.toFixed(2)}</Text>
                            </View>
                            <View style={[pmStyles.totalStripItem, pmStyles.totalStripLast]}>
                                <Text style={pmStyles.stripLabel}>Effective Total</Text>
                                <Text style={[pmStyles.stripValue, pmStyles.effectiveTotalVal]}>₹{effectiveTotal.toFixed(2)}</Text>
                            </View>
                        </View>

                        {/* ── Keyboard Input Fields ── */}
                        <View style={pmStyles.fieldsSection}>
                            {/* Cash Received */}
                            <View style={pmStyles.fieldGroup}>
                                <Text style={pmStyles.fieldLabel}>Cash Received</Text>
                                <View style={pmStyles.fieldInputWrap}>
                                    <Text style={pmStyles.currencySymbol}>₹</Text>
                                    <TextInput
                                        ref={receivedRef}
                                        style={pmStyles.fieldInput}
                                        value={receivedStr}
                                        onChangeText={handleReceivedChange}
                                        placeholder="0.00"
                                        placeholderTextColor={COLORS.textMuted}
                                        keyboardType="decimal-pad"
                                        returnKeyType="next"
                                        onSubmitEditing={() => customerCredit > 0 && dueRef.current?.focus()}
                                        selectTextOnFocus
                                    />
                                </View>
                            </View>

                            {/* Pay Previous Due — only if customer has credit */}
                            {customerCredit > 0 && (
                                <View style={pmStyles.fieldGroup}>
                                    <Text style={pmStyles.fieldLabel}>
                                        Pay Previous Due
                                        <Text style={{ color: COLORS.textMuted }}> (max ₹{customerCredit.toFixed(2)})</Text>
                                    </Text>
                                    <View style={[pmStyles.fieldInputWrap, pmStyles.fieldInputWrapDue]}>
                                        <Text style={pmStyles.currencySymbol}>₹</Text>
                                        <TextInput
                                            ref={dueRef}
                                            style={pmStyles.fieldInput}
                                            value={addedDueStr}
                                            onChangeText={handleDueChange}
                                            placeholder="0.00"
                                            placeholderTextColor={COLORS.textMuted}
                                            keyboardType="decimal-pad"
                                            returnKeyType="done"
                                            selectTextOnFocus
                                        />
                                    </View>
                                </View>
                            )}
                        </View>

                        {/* Live change / due status stripe */}
                        <View style={pmStyles.statusStripe}>
                            {receivedNum > 0 ? (
                                change >= 0 ? (
                                    <View style={pmStyles.changeBadge}>
                                        <Ionicons name="arrow-up-circle" size={18} color="#16A34A" />
                                        <Text style={pmStyles.changeText}>Change: ₹{change.toFixed(2)}</Text>
                                    </View>
                                ) : (
                                    <View style={[pmStyles.changeBadge, pmStyles.dueBadge]}>
                                        <Ionicons name="alert-circle" size={18} color={COLORS.error} />
                                        <Text style={pmStyles.dueText}>Short by: ₹{due.toFixed(2)}</Text>
                                    </View>
                                )
                            ) : receivedStr === '0' || receivedStr === '0.' || receivedStr === '0.0' || receivedStr === '0.00' ? (
                                <View style={[pmStyles.changeBadge, pmStyles.dueBadge]}>
                                    <Ionicons name="time-outline" size={18} color={COLORS.error} />
                                    <Text style={pmStyles.dueText}>Full Due: ₹{effectiveTotal.toFixed(2)}</Text>
                                </View>
                            ) : (
                                <Text style={pmStyles.statusHint}>Type the cash amount received (0 for full due)</Text>
                            )}
                        </View>

                        {/* Quick-fill buttons */}
                        <View style={pmStyles.quickFill}>
                            {[50, 100, 200, 500].map(amt => (
                                <TouchableOpacity
                                    key={amt}
                                    style={pmStyles.quickBtn}
                                    onPress={() => setReceivedStr(String(amt))}
                                >
                                    <Text style={pmStyles.quickBtnText}>₹{amt}</Text>
                                </TouchableOpacity>
                            ))}
                            <TouchableOpacity
                                style={[pmStyles.quickBtn, pmStyles.exactBtn]}
                                onPress={() => setReceivedStr(effectiveTotal.toFixed(2))}
                            >
                                <Text style={[pmStyles.quickBtnText, { color: COLORS.primary }]}>Exact</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[pmStyles.quickBtn, { borderColor: COLORS.error, backgroundColor: COLORS.errorLight }]}
                                onPress={() => setReceivedStr('0')}
                            >
                                <Text style={[pmStyles.quickBtnText, { color: COLORS.error }]}>Full Due</Text>
                            </TouchableOpacity>
                            {customerCredit > 0 && (
                                <TouchableOpacity
                                    style={[pmStyles.quickBtn, pmStyles.exactBtn]}
                                    onPress={() => {
                                        setAddedDueStr(customerCredit.toString());
                                        const total = grandTotal + customerCredit;
                                        if (receivedNum < total) setReceivedStr(total.toFixed(2));
                                    }}
                                >
                                    <Text style={[pmStyles.quickBtnText, { color: COLORS.error }]}>Clear Due</Text>
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* Confirm */}
                        <View style={pmStyles.actions}>
                            <TouchableOpacity style={pmStyles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
                                <Text style={pmStyles.cancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[pmStyles.confirmBtn, !canConfirm && pmStyles.confirmDisabled]}
                                onPress={handleConfirm}
                                disabled={!canConfirm}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="checkmark-circle" size={22} color="#fff" />
                                <Text style={pmStyles.confirmText}>
                                    {receivedNum === 0 && effectiveTotal > 0 ? `Full Due ₹${effectiveTotal.toFixed(2)}` : due > 0 && receivedNum > 0 ? `Confirm (Due ₹${due.toFixed(2)})` : 'Confirm Payment'}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
});

const pmStyles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: COLORS.overlay, alignItems: 'center', justifyContent: 'center' },
    container: {
        width: Math.min(420, Dimensions.get('window').width * 0.9),
        maxHeight: Dimensions.get('window').height * 0.88,
        backgroundColor: COLORS.white,
        borderRadius: RADIUS.lg,
        overflow: 'hidden',
        ...SHADOWS.lg,
    },
    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
        borderBottomWidth: 0.5, borderBottomColor: COLORS.borderLight,
    },
    headerTitle: { fontSize: 16, fontWeight: '400', color: COLORS.textPrimary },
    headerSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
    closeBtn: {
        width: 30, height: 30, borderRadius: RADIUS.lg,
        backgroundColor: COLORS.bgSurface, alignItems: 'center', justifyContent: 'center',
    },
    // Total strip
    totalStrip: {
        flexDirection: 'row', backgroundColor: COLORS.bgSurface,
        borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
    },
    totalStripItem: { flex: 1, alignItems: 'center', paddingVertical: 8 },
    totalStripMid: { borderLeftWidth: 0.5, borderLeftColor: COLORS.borderLight },
    totalStripLast: { borderLeftWidth: 0.5, borderLeftColor: COLORS.border },
    stripLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: '500', textTransform: 'uppercase' },
    stripValue: { fontSize: FONT_SIZES.md, fontWeight: '500', color: COLORS.textPrimary, marginTop: 1 },
    effectiveTotalVal: { color: COLORS.primary, fontSize: FONT_SIZES.lg },
    // Keyboard input fields
    fieldsSection: {
        paddingHorizontal: SPACING.md,
        paddingVertical: SPACING.md,
        gap: SPACING.md,
    },
    fieldGroup: {
        gap: 4,
    },
    fieldLabel: {
        fontSize: FONT_SIZES.xs,
        fontWeight: '500',
        color: COLORS.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    fieldInputWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 0.5,
        borderColor: COLORS.primary,
        borderRadius: RADIUS.md,
        paddingHorizontal: SPACING.sm,
        backgroundColor: COLORS.primaryGhost,
    },
    fieldInputWrapDue: {
        borderColor: COLORS.error,
        backgroundColor: COLORS.errorLight,
    },
    currencySymbol: {
        fontSize: FONT_SIZES.xl,
        fontWeight: '500',
        color: COLORS.primary,
        paddingRight: 4,
    },
    fieldInput: {
        flex: 1,
        fontSize: FONT_SIZES.xl,
        fontWeight: '500',
        color: COLORS.textPrimary,
        paddingVertical: 10,
        outlineStyle: 'none',
    },
    // Legacy / Keep for compatibility
    inputsRow: { flexDirection: 'row' },
    inputBox: { flex: 1 },
    inputBoxActive: {},
    displayLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: '500', textTransform: 'uppercase' },
    displayValue: { fontSize: 32, fontWeight: '500', color: COLORS.textPrimary, letterSpacing: 1 },
    // Status Stripe
    statusStripe: {
        alignItems: 'center', paddingVertical: 6,
        backgroundColor: COLORS.bgSurface,
        minHeight: 34,
        justifyContent: 'center'
    },
    statusHint: { fontSize: FONT_SIZES.xs, fontWeight: '500', color: COLORS.textMuted },
    changeBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: '#dcfce7', paddingHorizontal: SPACING.sm, paddingVertical: 3,
        borderRadius: RADIUS.lg,
    },
    changeText: { fontSize: FONT_SIZES.xs, fontWeight: '500', color: '#16A34A' },
    dueBadge: { backgroundColor: COLORS.errorLight },
    dueText: { fontSize: FONT_SIZES.xs, fontWeight: '500', color: COLORS.error },
    // Quick fill
    quickFill: {
        flexDirection: 'row', gap: 5, flexWrap: 'wrap',
        paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
        backgroundColor: COLORS.bgSurface,
        borderTopWidth: 0.5, borderTopColor: COLORS.borderLight,
    },
    quickBtn: {
        paddingVertical: 6, paddingHorizontal: 12, borderRadius: RADIUS.sm,
        borderWidth: 0.5, borderColor: COLORS.border,
        alignItems: 'center', backgroundColor: COLORS.white,
    },
    exactBtn: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryGhost },
    quickBtnText: { fontSize: FONT_SIZES.sm, fontWeight: '500', color: COLORS.textSecondary },
    // Actions
    actions: {
        flexDirection: 'row', padding: 6, gap: 6,
        borderTopWidth: 0.5, borderTopColor: COLORS.borderLight,
    },
    cancelBtn: {
        flex: 1, paddingVertical: 10, borderRadius: RADIUS.md,
        borderWidth: 0.5, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center',
    },
    cancelText: { fontSize: FONT_SIZES.xs, fontWeight: '500', color: COLORS.textSecondary },
    confirmBtn: {
        flex: 2.5, flexDirection: 'row', paddingVertical: 10, borderRadius: RADIUS.md,
        backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', gap: 5,
    },
    confirmDisabled: { backgroundColor: COLORS.border },
    confirmText: { fontSize: FONT_SIZES.xs, fontWeight: '500', color: '#fff' },
});




const DEFAULT_DISCOUNT = 15; // Default discount % for new cart items

export default function BillingScreen({ navigation, route }) {
    const editInvoice = route?.params?.invoice || null;
    const r = useResponsive();
    // Search Products
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    // ─── PRELOADED PRODUCT LIST (for instant local search) ───
    const [allProducts, setAllProducts] = useState([]);
    const [productsLoaded, setProductsLoaded] = useState(false);

    // Customer Selection
    const [customerQuery, setCustomerQuery] = useState('');
    const [customerResults, setCustomerResults] = useState([]);
    const [customerLoading, setCustomerLoading] = useState(false);
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [customerCredit, setCustomerCredit] = useState(0);   // outstanding due balance

    // Cart
    const [cart, setCart] = useState([]);
    const [paymentMethod, setPaymentMethod] = useState('cash');
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [advancedOptionsVisible, setAdvancedOptionsVisible] = useState(false);

    // FEFO Warning Modal
    const [fefoWarningVisible, setFefoWarningVisible] = useState(false);
    const [fefoWarningTitle, setFefoWarningTitle] = useState('');
    const [fefoWarningMessage, setFefoWarningMessage] = useState('');

    // Doctor Fee & OTC Items
    const [doctorFee, setDoctorFee] = useState('');
    const [otcItems, setOtcItems] = useState([{ name: '', price: '' }]);

    // Payment Modal (credit/due system)
    const [paymentModalVisible, setPaymentModalVisible] = useState(false);

    // Print / Save modal
    const [printModalVisible, setPrintModalVisible] = useState(false);
    const savedInvoiceRef = useRef(null);

    // Last Purchase Custom Modal
    const [lastPurchaseModalVisible, setLastPurchaseModalVisible] = useState(false);
    const [pendingLastItems, setPendingLastItems] = useState(null);

    // Free / Manual Entry Row (for unlisted medicines)
    const [showFreeEntry, setShowFreeEntry] = useState(false);
    const [freeEntry, setFreeEntry] = useState({ name: '', mrp: '', stock: '' });
    const [freeEntryLoading, setFreeEntryLoading] = useState(false);

    // Recent Sales
    const [recentSales, setRecentSales] = useState([]);
    const [recentSalesLoading, setRecentSalesLoading] = useState(false);

    const [alerts, setAlerts] = useState([]);
    const [alertsLoading, setAlertsLoading] = useState(false);
    const [todayStats, setTodayStats] = useState({ todaySales: 0, totalOrders: 0 });
    const [softwareUsedTime, setSoftwareUsedTime] = useState({ hours: 0, minutes: 0 });

    const fetchAlerts = async () => {
        setAlertsLoading(true);
        try {
            const [lowStockRes, expiryRes] = await Promise.all([
                api.get('/product/lowstock').catch(() => null),
                api.get('/product/soontoexpiry').catch(() => null)
            ]);
            
            const newAlerts = [];
            
            if (lowStockRes?.data?.data) {
                lowStockRes.data.data.forEach(item => {
                    newAlerts.push({
                        id: item._id + '_low',
                        type: 'low_stock',
                        name: item.medicine_name,
                        stock: item.quantity
                    });
                });
            }
            
            if (expiryRes?.data?.data) {
                const today = new Date();
                today.setHours(0,0,0,0);
                expiryRes.data.data.forEach(item => {
                    const expDate = new Date(item.expiry_date);
                    if (expDate >= today) {
                        const diffTime = expDate - today;
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                        newAlerts.push({
                            id: item._id + '_exp',
                            type: 'expiry',
                            name: item.medicine_name,
                            days: diffDays,
                            isExpired: false
                        });
                    }
                });
            }
            
            setAlerts(newAlerts);
        } catch (error) {
            console.warn('Failed to fetch alerts', error);
        } finally {
            setAlertsLoading(false);
        }
    };

    const fetchTodayStats = async () => {
        try {
            const response = await api.get('/sales/today');
            if (response && response.data && response.data.data) {
                setTodayStats({
                    todaySales: response.data.data.total_sales ?? 0,
                    totalOrders: response.data.data.total_orders ?? 0,
                });
            }
        } catch (error) {
            console.warn('Failed to fetch today stats:', error);
        }
    };

    useFocusEffect(
        useCallback(() => {
            fetchTodayStats();
            
            let interval;
            const initUsageTime = async () => {
                const now = new Date();
                const todayStr = now.toDateString();
                
                try {
                    let savedData = await AsyncStorage.getItem('software_usage_start');
                    let startData = savedData ? JSON.parse(savedData) : null;
                    
                    if (!startData || startData.date !== todayStr) {
                        // Start fresh for today
                        startData = {
                            date: todayStr,
                            timestamp: now.getTime()
                        };
                        await AsyncStorage.setItem('software_usage_start', JSON.stringify(startData));
                    }
                    
                    const startTime = startData.timestamp;
                    
                    const updateUsageTime = () => {
                        const currentTime = new Date().getTime();
                        const diffMs = currentTime - startTime;
                        const totalMinutes = Math.floor(diffMs / 60000);
                        const hours = Math.floor(totalMinutes / 60);
                        const minutes = totalMinutes % 60;
                        setSoftwareUsedTime({ hours, minutes });
                    };
                    
                    updateUsageTime();
                    interval = setInterval(updateUsageTime, 60000);
                } catch (e) {
                    console.warn("Error loading usage time", e);
                }
            };
            
            initUsageTime();
            
            return () => {
                if (interval) clearInterval(interval);
            };
        }, [])
    );



    const fetchRecentSalesList = async () => {
        try {
            setRecentSalesLoading(true);
            const res = await getRecentSales({ page: 1, limit: 10, sort: 'desc' });
            const list = Array.isArray(res)
                ? res
                : (Array.isArray(res?.data)
                    ? res.data
                    : (Array.isArray(res?.invoices)
                        ? res.invoices
                        : []));
            setRecentSales(list);
        } catch (error) {
            console.warn('Failed to fetch recent sales:', error.message);
        } finally {
            setRecentSalesLoading(false);
        }
    };

    const searchTimeout = useRef(null);
    const customerSearchTimeout = useRef(null);

    useEffect(() => {
        if (editInvoice && editInvoice.items && productsLoaded) {
            const mappedCart = editInvoice.items.map((it) => {
                const pid = it.product_id;
                // Find the product in allProducts to get current inventory stock
                const inventoryProduct = allProducts.find(p => 
                    String(p._id || p.id) === String(pid)
                );
                const currentInventoryStock = inventoryProduct ? (inventoryProduct.quantity ?? 0) : 0;
                // Available stock = what's currently in inventory + what was sold in this invoice
                const totalAvailable = currentInventoryStock + (it.quantity || 0);

                return {
                    ...it,
                    _id: pid,
                    cart_quantity: it.quantity,
                    mrp: it.mrp || 0,
                    discount_percent: it.discount_percent || 0,
                    available_stock: totalAvailable,
                };
            });
            setCart(mappedCart);

            if (editInvoice.customer && editInvoice.customer_name) {
                const customerIdStr = typeof editInvoice.customer === 'object' ? (editInvoice.customer._id || editInvoice.customer.id) : editInvoice.customer;
                const c = {
                    _id: customerIdStr,
                    name: editInvoice.customer_name,
                    phone_no: editInvoice.customer_phone || ''
                };
                handleSelectCustomer(c);
            }
        }
    }, [editInvoice, productsLoaded]);
    const searchInputRef = useRef(null);
    const customerCacheRef = useRef(new MemoryCache(120000)); // 2-min TTL

    // ─── PRELOAD ALL PRODUCTS ON MOUNT ──────────────────
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await getProducts();
                if (!cancelled) {
                    setAllProducts(res?.data ?? []);
                    setProductsLoaded(true);
                }
            } catch (e) {
                console.warn('Product preload failed:', e.message);
            }
            try {
                if (!cancelled) {
                    await fetchRecentSalesList();
                    await fetchAlerts();
                    await fetchTodayStats();
                }
            } catch (e) {
                console.warn('Fetch recent sales on mount failed:', e.message);
            }
        })();
        return () => { cancelled = true; };
    }, []);



    // ─── KEEP FOCUS ON SEARCH INPUT ──────────────────────
    // Always re-focus the barcode/product search input unless an
    // explicit interactive element (input, textarea, select) was clicked,
    // OR a modal is currently open (focus-stealing breaks modal button clicks).
    const anyModalOpen = paymentModalVisible || printModalVisible || lastPurchaseModalVisible || showFreeEntry || advancedOptionsVisible;
    const anyModalOpenRef = useRef(anyModalOpen);
    anyModalOpenRef.current = anyModalOpen;

    useEffect(() => {
        if (Platform.OS !== 'web') return;

        const refocus = () => {
            // Don't steal focus when a modal is open — it breaks button presses
            if (anyModalOpenRef.current) return;
            setTimeout(() => {
                const active = document.activeElement;
                const tag = active?.tagName?.toLowerCase();
                // If another input/textarea/select is focused, don't steal focus
                if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
                searchInputRef.current?.focus();
            }, 0);
        };

        document.addEventListener('click', refocus, true);
        return () => document.removeEventListener('click', refocus, true);
    }, []);

    // Re-focus search input when modals close
    useEffect(() => {
        if (!paymentModalVisible && !printModalVisible && !lastPurchaseModalVisible && !showFreeEntry) {
            const t = setTimeout(() => searchInputRef.current?.focus(), 200);
            return () => clearTimeout(t);
        }
    }, [paymentModalVisible, printModalVisible, lastPurchaseModalVisible, showFreeEntry]);



    // ─── SEARCH CUSTOMERS ──────────────────────────
    const handleCustomerSearch = useCallback((query) => {
        setCustomerQuery(query);
        if (customerSearchTimeout.current) clearTimeout(customerSearchTimeout.current);

        if (!query.trim()) {
            setCustomerResults([]);
            setShowCustomerDropdown(false);
            return;
        }

        // Check cache first
        const cached = customerCacheRef.current.get(query.trim());
        if (cached) {
            setCustomerResults(cached);
            setShowCustomerDropdown(true);
            return;
        }

        customerSearchTimeout.current = setTimeout(async () => {
            setCustomerLoading(true);
            try {
                const response = await searchCustomer(query.trim());
                const list = response?.data ?? response ?? [];
                // top 5 recommendations
                const results = Array.isArray(list) ? list.slice(0, 5) : [];
                setCustomerResults(results);
                customerCacheRef.current.set(query.trim(), results);
                setShowCustomerDropdown(true);
            } catch {
                setCustomerResults([]);
            } finally {
                setCustomerLoading(false);
            }
        }, 300);
    }, []);

    const handleSelectCustomer = async (c) => {
        setSelectedCustomer(c);
        setCustomerCredit(0);
        setCustomerQuery('');
        setCustomerResults([]);
        setShowCustomerDropdown(false);

        const cid = c._id || c.id || c.customer_id;

        // Fetch credit balance in background
        try {
            const creditRes = await getCustomerCredit(cid);

            console.log("Credit API Response:", creditRes);

            const balance =
                creditRes?.credit_balance ??
                creditRes?.due_amount ??
                creditRes?.balance ??
                0;

            setCustomerCredit(balance);
        } catch {
            // credit endpoint might not exist yet — silently ignore
        }

        // Auto-load last purchase if available
        try {
            const res = await getCustomerLastPurchase(cid);
            const invoiceData = res?.data;
            if (!invoiceData) return;
            const lastItems = invoiceData.items;

            if (Array.isArray(lastItems) && lastItems.length > 0) {
                console.log(lastItems);
                setPendingLastItems(lastItems);
                setLastPurchaseModalVisible(true);
            }
        } catch (e) {
            setCustomerLoading(false);
            console.warn('Could not load last purchase:', e.message);
        }
    };

    // ─── SEARCH PRODUCTS ─────────────────────────────
    const handleSearch = useCallback((query) => {
        setSearchQuery(query);
        if (searchTimeout.current) clearTimeout(searchTimeout.current);

        if (!query.trim()) {
            setSearchResults([]);
            setShowDropdown(false);
            return;
        }

        searchTimeout.current = setTimeout(() => {
            // If products are preloaded, search locally (instant)
            if (productsLoaded && allProducts.length > 0) {
                console.log("Searching locally");
                const q = query.trim().toLowerCase();
                const filtered = allProducts.filter(p =>
                    (p.medicine_name && p.medicine_name.toLowerCase().includes(q)) ||
                    p.barcode === query.trim() ||
                    p.short_barcode === query.trim()
                );
                setSearchResults(filtered.slice(0, 30));
                setShowDropdown(true);
                return;
            }

            // Fallback: API search if preload failed
            (async () => {
                setSearchLoading(true);
                try {
                    const response = await searchProducts({ query: query.trim(), type: 'name' });
                    const products = response?.data ?? response?.products ?? response ?? [];
                    setSearchResults(Array.isArray(products) ? products.slice(0, 30) : []);
                    setShowDropdown(true);
                } catch {
                    setSearchResults([]);
                } finally {
                    setSearchLoading(false);
                }
            })();
        }, 250);
    }, [productsLoaded, allProducts]);

    // ─── CART ───────────────────────────────────────
    const addToCart = useCallback((product, force = false) => {
        const maxStock = product.quantity ?? product.stock ?? 0;

        // Block out-of-stock products completely
        if (maxStock <= 0) {
            Alert.alert('Out of Stock', `"${product.medicine_name || product.name || 'This product'}" is out of stock.`);
            return;
        }

        const pid = product._id || product.id || product.product_id;

        // FEFO Check: Hard Block if selling a newer batch when older is available
        if (!force) {
            const name = (product.medicine_name || product.name || '').trim().toLowerCase();
            const inStockSiblings = allProducts.filter(p => 
                (p.medicine_name || p.name || '').trim().toLowerCase() === name && 
                (p.quantity ?? p.stock ?? 0) > 0
            );

            // Sort siblings by expiry_date (nulls at the bottom)
            inStockSiblings.sort((a, b) => {
                const dateA = a.expiry_date || a.expiry;
                const dateB = b.expiry_date || b.expiry;
                
                let diff = 0;
                if (!dateA && !dateB) diff = 0;
                else if (!dateA) diff = 1;
                else if (!dateB) diff = -1;
                else diff = new Date(dateA) - new Date(dateB);

                // Fallback to insertion order (older _id comes first) if dates match
                if (diff === 0) {
                    const idA = (a._id || a.id || '').toString();
                    const idB = (b._id || b.id || '').toString();
                    return idA.localeCompare(idB);
                }
                return diff;
            });
            
            if (inStockSiblings.length > 1) {
                const currentIndex = inStockSiblings.findIndex(p => (p._id || p.id || '').toString() === pid.toString());
                
                if (currentIndex > 0) {
                    const olderBatch = inStockSiblings[0];
                    setFefoWarningTitle('FEFO Policy Violation');
                    setFefoWarningMessage(`You must clear the earlier expiry batch (${olderBatch.batch_no || 'Unknown'}) first. It still has ${olderBatch.quantity ?? olderBatch.stock} units available.`);
                    setFefoWarningVisible(true);
                    return; // HARD BLOCK
                }
            }
        }

        // Optimistic local stock deduction - keeps search results accurate
        setAllProducts(prev => prev.map(p =>
            (p._id || p.id) === pid ? { ...p, quantity: Math.max(0, (p.quantity ?? 0) - 1) } : p
        ));

        setCart((prev) => {
            const existing = prev.find((i) => (i._id || i.id || i.product_id) === pid);

            if (existing) {
                const totalAvailable = existing.available_stock || maxStock;
                if (existing.cart_quantity >= totalAvailable) {
                    Alert.alert('Stock Limit', `Only ${totalAvailable} units available.`);
                    return prev;
                }
                return prev.map((i) =>
                    (i._id || i.id || i.product_id) === pid
                        ? { ...i, cart_quantity: i.cart_quantity + 1 }
                        : i
                );
            }
            return [...prev, { ...product, available_stock: maxStock, cart_quantity: 1, discount_percent: DEFAULT_DISCOUNT }];
        });
        setSearchQuery('');
        setSearchResults([]);
        setShowDropdown(false);
        // Re-focus search input so barcode scanner / keyboard stays active
        setTimeout(() => searchInputRef.current?.focus(), 50);
    }, [allProducts, cart]);

    // Submit (Enter key / barcode scanner)
    const handleSubmitSearch = useCallback(async () => {
        const query = searchQuery.trim();
        if (!query) return;
        if (searchTimeout.current) clearTimeout(searchTimeout.current);

        // Local search first (instant barcode/name match)
        if (productsLoaded && allProducts.length > 0) {
            const q = query.toLowerCase();
            const list = allProducts.filter(p =>
                (p.medicine_name && p.medicine_name.toLowerCase().includes(q)) ||
                p.barcode === query ||
                p.short_barcode === query
            );
            if (list.length === 1) {
                addToCart(list[0]);
            } else {
                setSearchResults(list.slice(0, 30));
                setShowDropdown(true);
            }
            setTimeout(() => searchInputRef.current?.focus(), 50);
            return;
        }

        // Fallback: API search
        setSearchLoading(true);
        try {
            const response = await searchProducts({ query, type: 'name' });
            const products = response?.data ?? response?.products ?? response ?? [];
            const list = Array.isArray(products) ? products : [];

            if (list.length === 1) {
                addToCart(list[0]);
            } else {
                setSearchResults(list.slice(0, 30));
                setShowDropdown(true);
            }
        } catch {
            setSearchResults([]);
        } finally {
            setSearchLoading(false);
            // Always re-focus search input after submit (barcode scan)
            setTimeout(() => searchInputRef.current?.focus(), 50);
        }
    }, [searchQuery, addToCart, productsLoaded, allProducts]);

    const removeFromCart = useCallback((item) => {
        const pid = item._id || item.id || item.product_id;
        const oldQty = item.cart_quantity ?? 0;

        setCart((prev) => {
            let newCart = prev.filter((i) => (i._id || i.id || i.product_id) !== pid);
            
            // Cascading FEFO Check
            const name = (item.medicine_name || item.name || '').trim().toLowerCase();
            const dateA = item.expiry_date || item.expiry;
            
            const violatingBatches = newCart.filter(cartItem => {
                if ((cartItem.medicine_name || cartItem.name || '').trim().toLowerCase() !== name) return false;
                
                const dateB = cartItem.expiry_date || cartItem.expiry;
                let diff = 0;
                if (!dateA && !dateB) diff = 0;
                else if (!dateA) diff = -1;
                else if (!dateB) diff = 1;
                else diff = new Date(dateB) - new Date(dateA);
                
                if (diff === 0) {
                    const idA = (item._id || item.id || '').toString();
                    const idB = (cartItem._id || cartItem.id || '').toString();
                    return idB.localeCompare(idA) > 0;
                }
                return diff > 0;
            });

            if (violatingBatches.length > 0) {
                const violatingIds = violatingBatches.map(v => v._id || v.id || v.product_id);
                newCart = newCart.filter(i => !violatingIds.includes(i._id || i.id || i.product_id));
                
                setAllProducts(products => {
                    let updatedProducts = [...products];
                    // Restore main item
                    updatedProducts = updatedProducts.map(p => 
                        (p._id || p.id) === pid ? { ...p, quantity: (p.quantity ?? 0) + oldQty } : p
                    );
                    // Restore violating batches
                    violatingBatches.forEach(vb => {
                        const vbPid = vb._id || vb.id || vb.product_id;
                        const vbQty = vb.cart_quantity ?? 0;
                        updatedProducts = updatedProducts.map(p => 
                            (p._id || p.id) === vbPid ? { ...p, quantity: (p.quantity ?? 0) + vbQty } : p
                        );
                    });
                    return updatedProducts;
                });
                
                setFefoWarningTitle('FEFO Enforcement');
                setFefoWarningMessage(`Newer batches of "${item.medicine_name || item.name}" were automatically removed because you removed the older batch.`);
                setFefoWarningVisible(true);
            } else {
                setAllProducts(products => products.map(p => 
                    (p._id || p.id) === pid ? { ...p, quantity: (p.quantity ?? 0) + oldQty } : p
                ));
            }
            
            return newCart;
        });
    }, []);

    const updateQuantity = useCallback((item, newQty) => {
        const pid = item._id || item.id || item.product_id;
        if (newQty <= 0) {
            removeFromCart(item);
            return;
        }

        const oldQty = item.cart_quantity ?? 0;
        const diff = newQty - oldQty;
        const maxStock = item.available_stock ?? item.quantity ?? item.stock ?? 999;
        
        if (newQty > maxStock) {
            const remaining = newQty - maxStock;
            const name = (item.medicine_name || item.name || '').toLowerCase();
            // Find other batches of the same medicine
            const otherBatches = allProducts.filter(p => 
                (p.medicine_name || p.name || '').toLowerCase() === name && 
                (p._id || p.id) !== pid &&
                (p.quantity ?? p.stock ?? 0) > 0
            );

            if (otherBatches.length > 0) {
                Alert.alert(
                    'Stock Limit Reached', 
                    `This batch only has ${maxStock} units.\n\nAuto-add ${remaining} units from the next available batches?`,
                    [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Yes, Split Stock', onPress: () => {
                            let totalDiffForCurrent = maxStock - oldQty;
                            if (totalDiffForCurrent > 0) {
                                setAllProducts(products => products.map(p => 
                                    (p._id || p.id) === pid ? { ...p, quantity: Math.max(0, (p.quantity ?? 0) - totalDiffForCurrent) } : p
                                ));
                            }

                            setCart(prev => {
                                let newCart = [...prev];
                                newCart = newCart.map((i) => (i._id || i.id || i.product_id) === pid ? { ...i, cart_quantity: maxStock } : i);
                                
                                let stillNeeded = remaining;
                                for (const b of otherBatches) {
                                    if (stillNeeded <= 0) break;
                                    const bStock = b.quantity ?? b.stock ?? 0;
                                    const take = Math.min(bStock, stillNeeded);
                                    const bPid = b._id || b.id;

                                    setAllProducts(products => products.map(p => 
                                        (p._id || p.id) === bPid ? { ...p, quantity: Math.max(0, (p.quantity ?? 0) - take) } : p
                                    ));

                                    const existingIdx = newCart.findIndex(i => (i._id || i.id || i.product_id) === bPid);
                                    if (existingIdx >= 0) {
                                        newCart[existingIdx] = { ...newCart[existingIdx], cart_quantity: newCart[existingIdx].cart_quantity + take };
                                    } else {
                                        const pPrice = b.mrp ?? b.price ?? 0;
                                        newCart.push({ ...b, cart_quantity: take, cart_price: pPrice, discount_percent: item.discount_percent || 0 });
                                    }
                                    stillNeeded -= take;
                                }
                                if (stillNeeded > 0) {
                                     setTimeout(() => Alert.alert('Notice', `Added all available stock. Still short by ${stillNeeded} units.`), 500);
                                }
                                return newCart;
                            });
                        }}
                    ]
                );
                return;
            }

            Alert.alert('Stock Limit', `Only ${maxStock} units available.`);
            return;
        }

        // Apply normal stock deduction
        setAllProducts(products => products.map(p => 
            (p._id || p.id) === pid ? { ...p, quantity: Math.max(0, (p.quantity ?? 0) - diff) } : p
        ));

        setCart((prev) => {
            let newCart = prev.map((i) =>
                (i._id || i.id || i.product_id) === pid ? { ...i, cart_quantity: newQty } : i
            );

            if (diff < 0) {
                const name = (item.medicine_name || item.name || '').trim().toLowerCase();
                const dateA = item.expiry_date || item.expiry;
                
                const violatingBatches = newCart.filter(cartItem => {
                    if ((cartItem.medicine_name || cartItem.name || '').trim().toLowerCase() !== name) return false;
                    if ((cartItem._id || cartItem.id || cartItem.product_id) === pid) return false;
                    
                    const dateB = cartItem.expiry_date || cartItem.expiry;
                    let d = 0;
                    if (!dateA && !dateB) d = 0;
                    else if (!dateA) d = -1;
                    else if (!dateB) d = 1;
                    else d = new Date(dateB) - new Date(dateA);
                    
                    if (d === 0) {
                        const idA = (item._id || item.id || '').toString();
                        const idB = (cartItem._id || cartItem.id || '').toString();
                        return idB.localeCompare(idA) > 0;
                    }
                    return d > 0;
                });

                if (violatingBatches.length > 0) {
                    const violatingIds = violatingBatches.map(v => v._id || v.id || v.product_id);
                    newCart = newCart.filter(i => !violatingIds.includes(i._id || i.id || i.product_id));
                    
                    setAllProducts(products => {
                        let updatedProducts = [...products];
                        violatingBatches.forEach(vb => {
                            const vbPid = vb._id || vb.id || vb.product_id;
                            const vbQty = vb.cart_quantity ?? 0;
                            updatedProducts = updatedProducts.map(p => 
                                (p._id || p.id) === vbPid ? { ...p, quantity: (p.quantity ?? 0) + vbQty } : p
                            );
                        });
                        return updatedProducts;
                    });
                    
                    setFefoWarningTitle('FEFO Enforcement');
                    setFefoWarningMessage(`Newer batches of "${item.medicine_name || item.name}" were automatically removed because you reduced the quantity of an older batch.`);
                    setFefoWarningVisible(true);
                }
            }
            return newCart;
        });
    }, [allProducts, removeFromCart]);

    const updateDiscount = useCallback((item, discount) => {
        const pid = item._id || item.id || item.product_id;
        setCart((prev) =>
            prev.map((i) =>
                (i._id || i.id || i.product_id) === pid ? { ...i, discount_percent: discount } : i
            )
        );
    }, []);



    // ─── LOOSE TABLET MODE ──────────────────────────────────────────
    // Toggle between strip-based and loose-tablet-based selling for a product
    const toggleLooseMode = useCallback((item) => {
        const pid = item._id || item.id || item.product_id;
        setCart((prev) =>
            prev.map((i) => {
                if ((i._id || i.id || i.product_id) !== pid) return i;
                const nowLoose = !i.is_loose_mode;
                return {
                    ...i,
                    is_loose_mode: nowLoose,
                    // Reset loose fields when toggling on; preserve original strip qty when toggling off
                    loose_tablet_count: nowLoose ? (i.loose_tablet_count ?? 1) : undefined,
                    loose_price_per_tablet: i.loose_price_per_tablet ?? null,
                    loose_total_price: i.loose_total_price ?? null,
                    loose_loading: nowLoose, // will trigger fetch
                    loose_error: null,
                };
            })
        );
    }, []);

    // Update tablet count and fetch latest price from API
    const updateLooseTablets = useCallback(async (item, tabletCount) => {
        const pid = item._id || item.id || item.product_id;
        const n = Math.max(1, Math.floor(Number(tabletCount) || 1));

        // Optimistically update count + set loading
        setCart((prev) =>
            prev.map((i) =>
                (i._id || i.id || i.product_id) === pid
                    ? { ...i, loose_tablet_count: n, loose_loading: true, loose_error: null }
                    : i
            )
        );

        try {
            const result = await getLoosePrice(pid, n);
            const price_per_tablet = result?.price_per_tablet ?? 0;
            const total_price = result?.total_price ?? price_per_tablet * n;
            setCart((prev) =>
                prev.map((i) =>
                    (i._id || i.id || i.product_id) === pid
                        ? {
                            ...i,
                            loose_tablet_count: n,
                            loose_price_per_tablet: price_per_tablet,
                            loose_total_price: total_price,
                            loose_loading: false,
                            loose_error: null,
                        }
                        : i
                )
            );
        } catch (err) {
            const errMsg = err?.message || 'Price fetch failed';
            setCart((prev) =>
                prev.map((i) =>
                    (i._id || i.id || i.product_id) === pid
                        ? { ...i, loose_loading: false, loose_error: errMsg }
                        : i
                )
            );
        }
    }, []);

    const clearCart = useCallback(() => {
        if (cart.length === 0) return;
        Alert.alert('Void Sale', 'Remove all items from this sale?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Void', style: 'destructive', onPress: () => {
                setAllProducts(products => {
                    let updated = [...products];
                    cart.forEach(cartItem => {
                        const pid = cartItem._id || cartItem.id || cartItem.product_id;
                        updated = updated.map(p => 
                            (p._id || p.id) === pid ? { ...p, quantity: (p.quantity ?? 0) + (cartItem.cart_quantity ?? 0) } : p
                        );
                    });
                    return updated;
                });
                setCart([]);
            } },
        ]);
    }, [cart]);

    // ─── TOTALS ─────────────────────────────────────
    const cartSummary = useMemo(() => {
        let subtotal = 0;
        let totalDiscount = 0;

        cart.forEach((item) => {
            if (item.is_loose_mode) {
                const looseTotal = item.loose_total_price ?? 0;
                subtotal += looseTotal;
            } else {
                const price = item.mrp ?? item.selling_price ?? item.price ?? 0;
                const qty = item.cart_quantity ?? 1;
                const lineGross = price * qty;
                const lineDisc = lineGross * ((item.discount_percent ?? 0) / 100);
                subtotal += lineGross;
                totalDiscount += lineDisc;
            }
        });

        const docFee = parseFloat(doctorFee) || 0;
        const otcTotal = otcItems.reduce((acc, item) => acc + (parseFloat(item.price) || 0), 0);

        const medicineTotalAfterDiscount = subtotal - totalDiscount;
        const grandTotal = medicineTotalAfterDiscount + docFee + otcTotal;

        return {
            subtotal,
            totalDiscount,
            doctorFee: docFee,
            otcTotal,
            grandTotal,
            itemCount: cart.reduce((s, i) => s + (i.is_loose_mode ? (i.loose_tablet_count ?? 1) : (i.cart_quantity ?? 1)), 0),
        };
    }, [cart, doctorFee, otcItems]);

    
    // -- checkout handler -- 
    const handleCheckout = useCallback(async () => {
        if (cart.length === 0) {
            Alert.alert('Empty Cart', 'Add items before checkout.');
            return;
        }

        // direct checkout for walkin customers
        if (!selectedCustomer) {
            processPaymentRef.current({
                amount_paid: cartSummary.grandTotal,
                previous_due_payment: 0,
                due_amount: 0,
                change_amount: 0,
            });
            return;
        }

        // for customer selected, fetching dues
        try {
            
            const creditRes = await getCustomerCredit(selectedCustomer._id);

            const balance = creditRes?.credit_balance ?? 0;

            setCustomerCredit(Number(balance) || 0);

        } catch (err) {
            console.warn("Credit fetch failed:", err.message);
            setCustomerCredit(0);
        }

        setPaymentModalVisible(true);
    }, [cart, selectedCustomer, cartSummary.grandTotal]);

    // process checkout 
    const processPayment = async ({
        amount_paid,
        cash_received,
        previous_due_payment,
        due_amount,
        change_amount,
    }) => {

        setPaymentModalVisible(false);
        const cartSnapshot = [...cart];
        setCheckoutLoading(true);

        try {
            const payload = {
                items: cartSnapshot.map((item) => ({
                    product_id: item._id || item.id || item.product_id,
                    medicine_name: item.medicine_name || item.name || '',
                    mrp: item.mrp || 0,
                    quantity: item.is_loose_mode ? 1 : item.cart_quantity,
                    discount_percent: item.is_loose_mode ? 0 : (item.discount_percent ?? 0),
                    ...(item.is_loose_mode ? {
                        is_loose_sale: true,
                        loose_tablet_count: item.loose_tablet_count ?? 1,
                        loose_price_per_tablet: item.loose_price_per_tablet ?? 0,
                        loose_total_price: item.loose_total_price ?? 0,
                    } : {}),
                })),
                payment_method: paymentMethod,
                amount_paid,
                previous_due_payment,
                doctor_fee: parseFloat(doctorFee) || 0,
                otc_items: otcItems
                    .filter(i => i.name.trim() !== '' && parseFloat(i.price) > 0)
                    .map(i => ({ name: i.name.trim(), price: parseFloat(i.price) }))
            };

            if (selectedCustomer) {
                payload.customer_id =
                    selectedCustomer._id;

            } else if (customerQuery && customerQuery.trim() !== '') {
                payload.customer_name_fallback = customerQuery.trim();
            }

            let response;
            if (editInvoice) {
                response = await updateCheckout(editInvoice._id || editInvoice.id, payload);
                navigation.setParams({ invoice: null });
            } else {
                console.time("checkout-api");
                response = await processCheckout(payload);
                console.timeEnd("checkout-api");

            }

            const rawInvoice =
                response?.invoice ?? response?.data ?? response;

            const newCredit =
                response?.customer_credit_balance ?? 0;

            const savedDue =
                response?.due_amount ?? due_amount ?? 0;

            // update credit
            setCustomerCredit(Number(newCredit) || 0);

            savedInvoiceRef.current = rawInvoice;

            setCart([]);
            setSearchQuery('');
            setSearchResults([]);
            setDoctorFee('');
            setOtcItems([{ name: '', price: '' }]);

            // Re-fetch product list to get accurate stock after checkout
            // try {
            //     const freshProducts = await getProducts();
            //     setAllProducts(freshProducts?.data ?? []);
            // } catch (e) {
            //     console.warn('Product refresh after checkout failed:', e.message);
            // }

            customerCacheRef.current.clear(); //cache cleared

            // refresh recent sales and stats
            fetchRecentSalesList().catch(() => {});
            fetchTodayStats().catch(() => {});

            if (savedDue > 0 && selectedCustomer) {
                Alert.alert(
                    'Due Saved',
                    `₹${savedDue.toFixed(2)} saved to customer account.`,
                    [{ text: 'OK' }]
                );
            }

            setPrintModalVisible(true);
        } catch (err) {
            const errMsg =
                err?.response?.data?.message ||
                err?.message ||
                'Unable to process checkout';
            Alert.alert('Checkout Failed', errMsg);
        } finally {
            setCheckoutLoading(false);
        }
    };

    const processPaymentRef = useRef(processPayment);
    processPaymentRef.current = processPayment;

    // ─── PRINT HANDLERS ─────────────────────────────
    const handlePrintAndSave = () => {
        setPrintModalVisible(false);
        // Open a thermal receipt popup
        printReceipt(savedInvoiceRef.current);
    };

    const handleSaveOnly = () => {
        setPrintModalVisible(false);
    };

    // ─── CENTRALIZED KEYBOARD MANAGER ───
    const latestStateRef = useRef({
        cartLength: cart.length,
        anyModalOpen: anyModalOpen,
        printModalVisible: printModalVisible,
        handleCheckout,
        handlePrintAndSave,
        handleSaveOnly
    });
    // Update ref every render to avoid stale closures
    latestStateRef.current = {
        cartLength: cart.length,
        anyModalOpen: anyModalOpen,
        printModalVisible,
        handleCheckout,
        handlePrintAndSave,
        handleSaveOnly
    };

    useEffect(() => {
        if (Platform.OS !== 'web') return;

        const globalKeyHandler = (e) => {
            const state = latestStateRef.current;

            // P => Print, S => Save only
            if (state.printModalVisible) {
                if (e.key === 'p' || e.key === 'P') {
                    e.preventDefault();
                    e.stopPropagation();
                    state.handlePrintAndSave();
                    return;
                }
                if (e.key === 's' || e.key === 'S') {
                    e.preventDefault();
                    e.stopPropagation();
                    state.handleSaveOnly();
                    return;
                }
                // block other shortcuts while print modal is open
                return;
            }

            // pay => F9
            if (e.key === 'F9') {
                e.preventDefault();
                e.stopPropagation();
                // cart validation
                if (state.cartLength > 0 && !state.anyModalOpen) {
                    state.handleCheckout();
                }
                return;
            }
        };

        window.addEventListener('keydown', globalKeyHandler, true);
        return () => window.removeEventListener('keydown', globalKeyHandler, true);
    }, []);

    // helper 
    const getName = (item) => item.medicine_name;
    const getPrice = (item) => item.mrp ?? 0;

    const fefoPriorityIds = useMemo(() => {
        const fefoMap = {};
        searchResults.forEach(p => {
            const stock = p.quantity ?? p.stock ?? 0;
            if (stock <= 0) return;
            const name = p.medicine_name || p.name;
            if (!name) return;
            if (!fefoMap[name]) fefoMap[name] = [];
            fefoMap[name].push(p);
        });
        const firstIds = new Set();
        Object.values(fefoMap).forEach(siblings => {
            if (siblings.length <= 1) return;
            siblings.sort((a, b) => {
                const dateA = a.expiry_date || a.expiry;
                const dateB = b.expiry_date || b.expiry;
                let diff = 0;
                if (!dateA && !dateB) diff = 0;
                else if (!dateA) diff = 1;
                else if (!dateB) diff = -1;
                else diff = new Date(dateA) - new Date(dateB);
                if (diff === 0) {
                    const idA = (a._id || a.id || '').toString();
                    const idB = (b._id || b.id || '').toString();
                    return idA.localeCompare(idB);
                }
                return diff;
            });
            const firstId = siblings[0]._id || siblings[0].id;
            if (firstId) firstIds.add(firstId);
        });
        return firstIds;
    }, [searchResults]);


    // ─── CUSTOMER STRIP: update credit display and clear button ─────────────────────────
    // Helper to clear selected customer and reset credit
    const clearCustomer = () => {
        setSelectedCustomer(null);
        setCustomerCredit(0);
    };

    // ─── FREE ENTRY: confirm & save unlisted medicine ───────────────
    const handleConfirmFreeEntry = async () => {
        const name = freeEntry.name.trim();
        const mrp = parseFloat(freeEntry.mrp);
        const stock = parseInt(freeEntry.stock, 10);

        if (!name) { Alert.alert('Required', 'Please enter a medicine name.'); return; }
        if (isNaN(mrp) || mrp <= 0) { Alert.alert('Required', 'Please enter a valid MRP.'); return; }
        if (isNaN(stock) || stock <= 0) { Alert.alert('Required', 'Please enter the stock quantity.'); return; }

        setFreeEntryLoading(true);
        let savedProduct = null;
        try {
            // Save to inventory with the entered stock quantity
            const res = await createProduct({
                medicine_name: name,
                mrp,
                selling_price: mrp,
                quantity: stock,
                category: 'General',
            });
            savedProduct = res?.data ?? res;
        } catch (err) {
            console.warn('createProduct failed (still adding to cart):', err.message);
        } finally {
            setFreeEntryLoading(false);
        }

        // Add to cart with qty=1, discount editable inline
        const cartItem = {
            _id: savedProduct?._id ?? `manual_${Date.now()}`,
            medicine_name: name,
            mrp,
            selling_price: mrp,
            available_stock: savedProduct?.quantity ?? stock,
            quantity: savedProduct?.quantity ?? stock,
            cart_quantity: 1,
            discount_percent: DEFAULT_DISCOUNT,
            is_manual_entry: true,
        };
        setCart(prev => [...prev, cartItem]);
        setFreeEntry({ name: '', mrp: '', stock: '' });
        setShowFreeEntry(false);
    };

    const PAYMENT_METHODS = [
        { key: 'cash', label: 'Cash' },
        { key: 'upi', label: 'UPI' },
        { key: 'card', label: 'Card' },
    ];

    // Responsive panel flex ratios — tuned for 1280×800 (xlarge)
    const leftFlex = r.pick({ small: 1.8, medium: 2.2, large: 3, xlarge: 3.2 });
    const rightFlex = r.pick({ small: 1.0, medium: 1.2, large: 1.3, xlarge: 1.4 });
    const isStacked = false; // Enforce horizontal layout on all screen sizes as requested
    // Search box height responsive
    const searchBoxH = r.pick({ small: 48, medium: 52, large: 56, xlarge: 52 });

    return (
        <View style={{ flex: 1, backgroundColor: COLORS.bgDark }}>
            <View style={[styles.container, r.isSmall && { flexDirection: 'column' }]}>
                {/* ═══════════ LEFT PANE ═══════════ */}
                <View style={[styles.leftPane, { flex: r.isSmall ? 1 : leftFlex }]}>
        
                {/* ── Invoice Metadata Bar ── */}
                {!r.isSmall && (
                    <View style={erpStyles.metaBar}>
                        <View style={erpStyles.metaItem}>
                        <Text style={erpStyles.metaLabel}>BILL NO:</Text>
                        <Text style={erpStyles.metaValue}>{editInvoice ? (editInvoice.invoice_number || 'EDIT') : 'AUTO-GEN'}</Text>
                    </View>
                    <Text style={erpStyles.metaSep}>│</Text>
                    <View style={erpStyles.metaItem}>
                        <Text style={erpStyles.metaLabel}>DATE:</Text>
                        <Text style={erpStyles.metaValue}>{new Date().toLocaleDateString('en-GB')}</Text>
                    </View>
                    <Text style={erpStyles.metaSep}>│</Text>
                    <View style={erpStyles.metaItem}>
                        <Text style={erpStyles.metaLabel}>OPERATOR:</Text>
                        <Text style={erpStyles.metaValue}>ADMIN_01</Text>
                    </View>
                    <View style={{ flex: 1 }} />
                    <View style={erpStyles.metaItem}>
                        <Ionicons name="wifi" size={10} color="#16A34A" style={{marginRight: 4}} />
                        <Text style={[erpStyles.metaValue, { color: '#16A34A' }]}>SYNCED</Text>
                    </View>
                    </View>
                )}

                {/* ── Combined Input Bar Row ── */}
                <View style={[styles.inputBarRow, r.isSmall && { flexDirection: 'column-reverse', height: 'auto', backgroundColor: '#fff', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, zIndex: 10 }]}>
                    {/* Customer Field */}
                    <View style={[styles.inputBarCell, { flex: r.isSmall ? undefined : 1, borderRightWidth: r.isSmall ? 0 : 0.5, borderRightColor: COLORS.border }, r.isSmall && { height: 56, width: '100%' }]}>
                        {selectedCustomer ? (
                            <View style={styles.selectedCustomerBar}>
                                <Ionicons name="person" size={16} color={COLORS.primary} style={{ marginRight: 6 }} />
                                <Text style={styles.selectedCustomerText} numberOfLines={1}>
                                    {selectedCustomer.name || selectedCustomer.customer_name}
                                </Text>
                                <Text style={styles.selectedCustomerPhone} numberOfLines={1}>
                                    {selectedCustomer.phone_no || selectedCustomer.phone_number}
                                </Text>
                                <TouchableOpacity onPress={clearCustomer} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ marginLeft: 'auto' }}>
                                    <Ionicons name="close-circle" size={18} color={COLORS.error} />
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <View style={styles.searchRelativeWrap}>
                                <View style={styles.inlineInputBar}>
                                    <Ionicons name="person-outline" size={16} color={COLORS.textMuted} style={{ marginRight: 6 }} />
                                    <TextInput
                                        style={[styles.inlineInput, r.isSmall && { fontSize: 16 }]}
                                        value={customerQuery}
                                        onChangeText={handleCustomerSearch}
                                        placeholder="Customer name or phone..."
                                        placeholderTextColor={COLORS.textMuted}
                                    />
                                    {customerQuery.length > 0 && (
                                        <TouchableOpacity onPress={() => { setCustomerQuery(''); setCustomerResults([]); setShowCustomerDropdown(false); }}>
                                            <Ionicons name="close-circle" size={16} color={COLORS.textMuted} />
                                        </TouchableOpacity>
                                    )}
                                    {customerLoading && <ActivityIndicator size="small" color={COLORS.primary} style={{ marginLeft: 4 }} />}
                                </View>

                                {/* Customer Dropdown */}
                                {showCustomerDropdown && customerResults.length > 0 && (
                                    <View style={erpStyles.dropdownBox}>
                                        <View style={erpStyles.dropdownHeader}>
                                            <Text style={[erpStyles.dropdownHeaderCol, { flex: 2 }]}>CUSTOMER NAME</Text>
                                            <Text style={[erpStyles.dropdownHeaderCol, { flex: 1.5 }]}>PHONE NUMBER</Text>
                                            <Text style={[erpStyles.dropdownHeaderCol, { flex: 1.2, textAlign: 'right' }]}>OUTSTANDING DUE</Text>
                                        </View>
                                        <ScrollView style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled">
                                            {customerResults.map((c, idx) => {
                                                const name = c.name || c.customer_name || 'N/A';
                                                const phone = c.phone_no || c.phone_number || 'N/A';
                                                const due = Number(c.due_balance ?? c.total_due ?? c.credit_balance ?? c.due ?? 0);
                                                return (
                                                    <TouchableOpacity
                                                        key={c._id || c.id || idx}
                                                        style={[erpStyles.dropdownRow, idx % 2 === 1 && { backgroundColor: '#F8F9F9' }]}
                                                        onPress={() => handleSelectCustomer(c)}
                                                        activeOpacity={0.7}
                                                    >
                                                        <Text style={[erpStyles.dropdownColTextBold, { flex: 2 }]} numberOfLines={1}>{name}</Text>
                                                        <Text style={[erpStyles.dropdownColText, { flex: 1.5 }]} numberOfLines={1}>{phone}</Text>
                                                        <Text style={[
                                                            erpStyles.dropdownColTextBold, 
                                                            { flex: 1.2, textAlign: 'right' }, 
                                                            due > 0 && { color: COLORS.error }
                                                        ]}>
                                                            {due > 0 ? `₹${due.toFixed(2)}` : '₹0.00'}
                                                        </Text>
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </ScrollView>
                                    </View>
                                )}
                            </View>
                        )}
                    </View>

                    {/* Product Search Field */}
                    <View style={[styles.inputBarCell, { flex: r.isSmall ? undefined : 1.6 }, r.isSmall && { height: 76, width: '100%', borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: '#F8FAFC' }]}>
                        <View style={styles.searchRelativeWrap}>
                            <View style={[styles.inlineInputBar, r.isSmall && { paddingHorizontal: 12 }]}>
                                <Ionicons name="scan-outline" size={r.isSmall ? 20 : 16} color={COLORS.textMuted} style={{ marginRight: 6 }} />
                                <TextInput
                                    ref={searchInputRef}
                                    nativeID="product-search-input"
                                    style={[styles.inlineInput, r.isSmall && { fontSize: 16 }]}
                                    value={searchQuery}
                                    onChangeText={handleSearch}
                                    onSubmitEditing={handleSubmitSearch}
                                    onKeyPress={(e) => {
                                    }}
                                    placeholder="Scan barcode or type medicine name..."
                                    placeholderTextColor={COLORS.textMuted}
                                    onKeyDown={(e) => {
  console.log(
    'keydown',
    e.nativeEvent.key,
    e.nativeEvent.ctrlKey
  );
}}
                                    autoFocus
                                    returnKeyType="search"
                                    onBlur={() => {
                                        setTimeout(() => {
                                            if (anyModalOpenRef.current) return;
                                            if (Platform.OS === 'web') {
                                                const tag = document.activeElement?.tagName?.toLowerCase();
                                                if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
                                            }
                                            searchInputRef.current?.focus();
                                        }, 100);
                                    }}
                                />
                                {searchQuery.length > 0 && (
                                    <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); setShowDropdown(false); }}>
                                        <Ionicons name="close-circle" size={r.isSmall ? 20 : 16} color={COLORS.textMuted} />
                                    </TouchableOpacity>
                                )}
                                {searchLoading && <ActivityIndicator size="small" color={COLORS.primary} style={{ marginLeft: 4 }} />}
                            </View>

                            {/* Product Search Dropdown */}
                            {showDropdown && searchResults.length > 0 && (
                                <View style={[erpStyles.dropdownBox, r.isSmall && { top: '100%' }]}>
                                    <View style={erpStyles.dropdownHeader}>
                                        <Text style={[erpStyles.dropdownHeaderCol, { flex: 2.5 }]}>MEDICINE NAME</Text>
                                        <Text style={[erpStyles.dropdownHeaderCol, { flex: 1 }]}>BATCH NO</Text>
                                        <Text style={[erpStyles.dropdownHeaderCol, { flex: 1 }]}>EXPIRY</Text>
                                        <Text style={[erpStyles.dropdownHeaderCol, { flex: 0.8, textAlign: 'right' }]}>STOCK</Text>
                                        <Text style={[erpStyles.dropdownHeaderCol, { flex: 1, textAlign: 'right' }]}>MRP</Text>
                                    </View>
                                    <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
                                        {searchResults.map((product, idx) => {
                                            const stock = product.quantity ?? product.stock ?? 0;
                                            const isOutOfStock = stock <= 0;
                                            const batch = product.batch_number || product.batch || 'N/A';
                                            const expiry = formatExpiryDate(product.expiry_date || product.expiry || 'N/A');
                                            const price = Number(getPrice(product)).toFixed(2);
                                            
                                            const isFefoPriority = fefoPriorityIds.has(product._id || product.id) && !isOutOfStock;
                                            return (
                                                <TouchableOpacity
                                                    key={product._id || product.id || idx}
                                                    style={[
                                                        erpStyles.dropdownRow, 
                                                        idx % 2 === 1 && { backgroundColor: '#F8F9F9' },
                                                        isOutOfStock && { backgroundColor: '#FFF5F5' }
                                                    ]}
                                                    onPress={() => !isOutOfStock && addToCart(product)}
                                                    activeOpacity={isOutOfStock ? 1 : 0.7}
                                                    disabled={isOutOfStock}
                                                >
                                                    <Text style={[
                                                        erpStyles.dropdownColTextBold, 
                                                        { flex: 2.5 }, 
                                                        isOutOfStock && { color: COLORS.textMuted, textDecorationLine: 'line-through' }
                                                    ]} numberOfLines={1}>
                                                        {getName(product)}
                                                    </Text>
                                                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                                        <Text style={erpStyles.dropdownColText} numberOfLines={1}>{batch}</Text>
                                                        {isFefoPriority && (
                                                            <Text style={{ backgroundColor: '#FEF08A', color: '#854D0E', fontSize: 8, fontWeight: '700', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4, overflow: 'hidden', marginLeft: 4 }}>Sell this first</Text>
                                                        )}
                                                    </View>
                                                    <Text style={[erpStyles.dropdownColText, { flex: 1 }]} numberOfLines={1}>{expiry}</Text>
                                                    <Text style={[
                                                        erpStyles.dropdownColTextBold, 
                                                        { flex: 0.8, textAlign: 'right' },
                                                        isOutOfStock ? { color: COLORS.error } : (stock < 5 && { color: COLORS.warning })
                                                    ]} numberOfLines={1}>
                                                        {isOutOfStock ? 'OUT' : stock}
                                                    </Text>
                                                    <Text style={[erpStyles.dropdownColTextBold, { flex: 1, textAlign: 'right', color: '#059669' }]} numberOfLines={1}>₹{price}</Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </ScrollView>
                                </View>
                            )}
                        </View>
                    </View>
                </View>

                {/* Credit badge below input bar */}
                {selectedCustomer && customerCredit > 0 && (
                    <View style={styles.creditBadgeStrip}>
                        <Ionicons name="alert-circle-outline" size={14} color={COLORS.error} />
                        <Text style={styles.creditBadgeText}>Outstanding due: ₹{customerCredit.toFixed(2)}</Text>
                    </View>
                )}

                {/* ── Ruled Table ── */}
                <View style={styles.tableContainer}>
                    <FlatList
                        data={cart}
                        keyExtractor={(item, i) => item._id || item.id || String(i)}
                        contentContainerStyle={cart.length === 0 ? { flexGrow: 1 } : null}
                        ListHeaderComponent={!r.isSmall ? () => (
                            <View style={styles.tableHeader}>
                                <View style={[styles.thCell, { flex: 2.5 }]}>
                                    <Text style={styles.th}>Medicine</Text>
                                </View>
                                <View style={[styles.thCell, { flex: 1.1, alignItems: 'center' }]}>
                                    <Text style={styles.th}>Qty</Text>
                                </View>
                                <View style={[styles.thCell, { flex: 1.1, alignItems: 'center' }]}>
                                    <Text style={styles.th}>MRP</Text>
                                </View>
                                <View style={[styles.thCell, { flex: 0.9, alignItems: 'center' }]}>
                                    <Text style={styles.th}>Disc%</Text>
                                </View>
                                <View style={[styles.thCell, { flex: 1.2, alignItems: 'flex-end', borderRightWidth: 0 }]}>
                                    <Text style={styles.th}>Amt</Text>
                                </View>
                            </View>
                        ) : null}
                        stickyHeaderIndices={!r.isSmall ? [0] : undefined}
                        ListEmptyComponent={() => (
                            <View style={styles.emptyTable}>
                                <Ionicons name="cart-outline" size={44} color={COLORS.border} />
                                <Text style={styles.emptyText}>No items in cart</Text>
                                <Text style={styles.emptySubtext}>Scan or search to add products</Text>
                            </View>
                        )}
                        renderItem={({ item, index }) => {
                            const isLoose = !!item.is_loose_mode;
                            const price = getPrice(item);
                            const qty = item.cart_quantity ?? 1;
                            const disc = item.discount_percent ?? 0;
                            const tabletCount = item.loose_tablet_count ?? 1;
                            const lineTotal = isLoose
                                ? (item.loose_total_price ?? 0)
                                : price * qty * (1 - disc / 100);
                            const canLoose = !!(item.tablets_per_strip && item.tablets_per_strip > 0);

                            if (r.isSmall) {
                                return (
                                    <View style={[styles.mobileCartRow, { padding: 8, paddingVertical: 10 }]}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                                                <Text style={[styles.mobileCartName, { fontSize: 14, fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>{getName(item)}</Text>
                                                {canLoose && (
                                                    <TouchableOpacity
                                                        style={[looseStyles.modePill, isLoose && looseStyles.modePillLoose, { marginLeft: 8 }]}
                                                        onPress={() => {
                                                            toggleLooseMode(item);
                                                            if (!isLoose) setTimeout(() => updateLooseTablets(item, item.loose_tablet_count ?? 1), 0);
                                                        }}
                                                    >
                                                        <Text style={[looseStyles.modePillText, isLoose && looseStyles.modePillTextLoose]}>{isLoose ? 'Loose' : 'Strip'}</Text>
                                                    </TouchableOpacity>
                                                )}
                                            </View>
                                            <TouchableOpacity onPress={() => removeFromCart(item)} style={{ paddingLeft: 12 }}>
                                                <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                                            </TouchableOpacity>
                                        </View>

                                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 0 }}>
                                                <TouchableOpacity onPress={() => isLoose ? updateLooseTablets(item, tabletCount - 1) : updateQuantity(item, qty - 1)} style={[styles.qtyBtn, { width: 44, height: 44, borderRadius: 2, backgroundColor: '#F3F5F4', borderWidth: 1, borderColor: '#C4CCCA' }]}>
                                                    <Ionicons name="remove" size={20} color={isLoose ? '#7C3AED' : '#1A2B28'} />
                                                </TouchableOpacity>
                                                <TextInput
                                                    style={[styles.qtyEditInput, { minWidth: 48, height: 44, fontSize: 16, fontWeight: '700', borderRadius: 0, borderWidth: 1, borderColor: '#C4CCCA', borderLeftWidth: 0, borderRightWidth: 0 }, isLoose && { color: '#7C3AED', borderColor: '#7C3AED' }]}
                                                    value={String(isLoose ? tabletCount : qty)}
                                                    onChangeText={(t) => {
                                                        const n = parseInt(t.replace(/[^0-9]/g, ''), 10);
                                                        if (isLoose) {
                                                            if (!isNaN(n) && n >= 1) updateLooseTablets(item, n);
                                                            else if (t === '') updateLooseTablets(item, 1);
                                                        } else {
                                                            const maxStock = item.available_stock ?? item.quantity ?? item.stock ?? 999;
                                                            if (!isNaN(n) && n >= 1 && n <= maxStock) updateQuantity(item, n);
                                                            else if (t === '') updateQuantity(item, 1);
                                                        }
                                                    }}
                                                    keyboardType="number-pad"
                                                    textAlign="center"
                                                    selectTextOnFocus
                                                />
                                                <TouchableOpacity onPress={() => isLoose ? updateLooseTablets(item, tabletCount + 1) : updateQuantity(item, qty + 1)} style={[styles.qtyBtn, { width: 44, height: 44, borderRadius: 2, backgroundColor: '#F3F5F4', borderWidth: 1, borderColor: '#C4CCCA' }]}>
                                                    <Ionicons name="add" size={20} color={isLoose ? '#7C3AED' : '#1A2B28'} />
                                                </TouchableOpacity>
                                            </View>

                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                                {!isLoose && disc > 0 && (
                                                    <View style={[styles.discActive, { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' }]}>
                                                        <Text style={{ fontSize: 10, fontWeight: '700', color: COLORS.error }}>{disc}% OFF</Text>
                                                    </View>
                                                )}
                                                <Text style={[styles.mobileCartAmount, { fontSize: 16, fontWeight: '700', color: '#1A2B28' }]}>₹{Number(lineTotal).toFixed(2)}</Text>
                                            </View>
                                        </View>
                                        
                                        {isLoose && item.loose_error && (
                                            <View style={[looseStyles.errorStrip, { borderRadius: 4, marginTop: 4 }]}>
                                                <Text style={looseStyles.errorText}>{item.loose_error}</Text>
                                            </View>
                                        )}
                                    </View>
                                );
                            }

                            return (
                                <View>
                                    <View style={[styles.tableRow, index % 2 !== 0 && { backgroundColor: '#F9F9F9' }]}>
                                        <View style={[styles.tdCell, { flex: 2.5, paddingVertical: 4 }]}>
                                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                                <Text style={styles.tdName} numberOfLines={1}>
                                                    {getName(item)}
                                                </Text>
                                                <TouchableOpacity onPress={() => removeFromCart(item)} style={styles.deleteBtn}>
                                                    <Ionicons name="close" size={14} color={COLORS.textMuted} />
                                                </TouchableOpacity>
                                            </View>
                                            


                                            {/* Loose / Strip toggle pill */}
                                            {canLoose && (
                                                <TouchableOpacity
                                                    style={[looseStyles.modePill, isLoose && looseStyles.modePillLoose]}
                                                    onPress={() => {
                                                        toggleLooseMode(item);
                                                        if (!isLoose) {
                                                            setTimeout(() => updateLooseTablets(item, item.loose_tablet_count ?? 1), 0);
                                                        }
                                                    }}
                                                    activeOpacity={0.75}
                                                >
                                                    <Ionicons
                                                        name={isLoose ? 'tablet-portrait-outline' : 'layers-outline'}
                                                        size={11}
                                                        color={isLoose ? '#7C3AED' : COLORS.textMuted}
                                                    />
                                                    <Text style={[looseStyles.modePillText, isLoose && looseStyles.modePillTextLoose]}>
                                                        {isLoose ? 'Loose' : 'Strip'}
                                                    </Text>
                                                </TouchableOpacity>
                                            )}
                                        </View>

                                        {/* Quantity / Tablet Count */}
                                        <View style={[styles.tdCell, { flex: 1.1, alignItems: 'center', justifyContent: 'center' }]}>
                                            {isLoose ? (
                                                <View style={styles.qtyCell}>
                                                    <TouchableOpacity
                                                        onPress={() => updateLooseTablets(item, tabletCount - 1)}
                                                        style={styles.qtyBtn}
                                                    >
                                                        <Ionicons name="remove" size={14} color='#7C3AED' />
                                                    </TouchableOpacity>
                                                    <TextInput
                                                        nativeID={index === 0 ? "qty-input-0" : undefined}
                                                        style={[styles.qtyEditInput, { color: '#7C3AED' }]}
                                                        value={String(tabletCount)}
                                                        onChangeText={(t) => {
                                                            const n = parseInt(t.replace(/[^0-9]/g, ''), 10);
                                                            if (!isNaN(n) && n >= 1) updateLooseTablets(item, n);
                                                            else if (t === '') updateLooseTablets(item, 1);
                                                        }}
                                                        keyboardType="number-pad"
                                                        selectTextOnFocus
                                                        textAlign="center"
                                                    />
                                                    <TouchableOpacity
                                                        onPress={() => updateLooseTablets(item, tabletCount + 1)}
                                                        style={styles.qtyBtn}
                                                    >
                                                        <Ionicons name="add" size={14} color='#7C3AED' />
                                                    </TouchableOpacity>
                                                </View>
                                            ) : (
                                                <View style={styles.qtyCell}>
                                                    <TouchableOpacity
                                                        onPress={() => updateQuantity(item, qty - 1)}
                                                        style={styles.qtyBtn}
                                                    >
                                                        <Ionicons name="remove" size={14} color={COLORS.primary} />
                                                    </TouchableOpacity>
                                                    <TextInput
                                                        nativeID={index === 0 ? "qty-input-0" : undefined}
                                                        style={styles.qtyEditInput}
                                                        value={String(qty)}
                                                        onChangeText={(t) => {
                                                            const n = parseInt(t.replace(/[^0-9]/g, ''), 10);
                                                            const maxStock = item.available_stock ?? item.quantity ?? item.stock ?? 999;
                                                            if (!isNaN(n) && n >= 1 && n <= maxStock) updateQuantity(item, n);
                                                            else if (t === '') updateQuantity(item, 1);
                                                        }}
                                                        keyboardType="number-pad"
                                                        selectTextOnFocus
                                                        textAlign="center"
                                                    />
                                                    <TouchableOpacity
                                                        onPress={() => updateQuantity(item, qty + 1)}
                                                        style={styles.qtyBtn}
                                                    >
                                                        <Ionicons name="add" size={14} color={COLORS.primary} />
                                                    </TouchableOpacity>
                                                </View>
                                            )}
                                        </View>

                                        {/* Price per unit (or per tablet in loose mode) */}
                                        <View style={[styles.tdCell, { flex: 1.1, alignItems: 'center', justifyContent: 'center' }]}>
                                            <Text
                                                style={[styles.td, { textAlign: 'center' }]}
                                                numberOfLines={1}
                                                adjustsFontSizeToFit
                                                minimumFontScale={0.8}
                                            >
                                                {isLoose
                                                    ? (item.loose_loading ? '...' : `₹${Number(item.loose_price_per_tablet ?? 0).toFixed(2)}`)
                                                    : `₹${Number(price).toFixed(2)}`}
                                            </Text>
                                        </View>

                                        {/* Disc% — disabled in loose mode */}
                                        <View style={[styles.tdCell, { flex: 0.9, alignItems: 'center', justifyContent: 'center' }]}>
                                            {isLoose ? (
                                                <Text style={{ fontSize: 11, color: COLORS.textMuted }}>—</Text>
                                            ) : (
                                                <View style={[
                                                    styles.discCell,
                                                    disc > 0 && styles.discActive,
                                                ]}>
                                                    <TextInput
                                                        style={[
                                                            styles.discEditInput,
                                                            disc > 0 && styles.discActiveText,
                                                        ]}
                                                        value={disc > 0 ? String(disc) : ''}
                                                        onChangeText={(t) => {
                                                            const cleaned = t.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                                                            const n = parseFloat(cleaned);
                                                            if (cleaned === '' || cleaned === '.') { updateDiscount(item, 0); return; }
                                                            if (!isNaN(n) && n >= 0 && n <= 100) updateDiscount(item, n);
                                                        }}
                                                        placeholder="%"
                                                        placeholderTextColor={COLORS.textMuted}
                                                        keyboardType="decimal-pad"
                                                        selectTextOnFocus
                                                        textAlign="center"
                                                    />
                                                    <Text style={{ fontSize: 10, color: disc > 0 ? COLORS.error : COLORS.textMuted }}>%</Text>
                                                </View>
                                            )}
                                        </View>

                                        {/* Amount */}
                                        <View style={[styles.tdCell, { flex: 1.2, alignItems: 'flex-end', justifyContent: 'center', borderRightWidth: 0 }]}>
                                            <Text
                                                style={styles.tdAmount}
                                                numberOfLines={1}
                                                adjustsFontSizeToFit
                                                minimumFontScale={0.8}
                                            >
                                                {isLoose && item.loose_loading ? '...' : `₹${Number(lineTotal).toFixed(2)}`}
                                            </Text>
                                        </View>
                                    </View>
                                    {/* Loose error / info strip */}
                                    {isLoose && item.loose_error && (
                                        <View style={looseStyles.errorStrip}>
                                            <Ionicons name="warning-outline" size={13} color={COLORS.error} />
                                            <Text style={looseStyles.errorText}>{item.loose_error}</Text>
                                        </View>
                                    )}
                                    {isLoose && !item.loose_error && item.loose_price_per_tablet && (
                                        <View style={looseStyles.infoStrip}>
                                            <Text style={looseStyles.infoText}>
                                                {tabletCount} tablet{tabletCount !== 1 ? 's' : ''} × ₹{Number(item.loose_price_per_tablet).toFixed(2)}/tab = ₹{Number(lineTotal).toFixed(2)}
                                            </Text>
                                        </View>
                                    )}
                                </View>
                            );
                        }}
                        showsVerticalScrollIndicator={true}
                    />
                </View>

                    {/* ── Free / Manual Entry Row ── */}
                    {showFreeEntry && (
                        <View style={styles.freeEntryRow}>
                            <TextInput
                                style={[styles.freeEntryInput, { flex: 3 }]}
                                placeholder="Medicine name *"
                                placeholderTextColor={COLORS.textMuted}
                                value={freeEntry.name}
                                onChangeText={t => setFreeEntry(p => ({ ...p, name: t }))}
                                autoFocus
                            />
                            <TextInput
                                style={[styles.freeEntryInput, { flex: 1.0, textAlign: 'center' }]}
                                placeholder="MRP *"
                                placeholderTextColor={COLORS.textMuted}
                                value={freeEntry.mrp}
                                onChangeText={t => setFreeEntry(p => ({ ...p, mrp: t.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1') }))}
                                keyboardType="decimal-pad"
                                textAlign="center"
                            />
                            <TextInput
                                style={[styles.freeEntryInput, { flex: 1.0, textAlign: 'center' }]}
                                placeholder="Stock *"
                                placeholderTextColor={COLORS.textMuted}
                                value={freeEntry.stock}
                                onChangeText={t => setFreeEntry(p => ({ ...p, stock: t.replace(/[^0-9]/g, '') }))}
                                keyboardType="number-pad"
                                textAlign="center"
                            />
                            <TouchableOpacity
                                style={styles.freeEntryConfirmBtn}
                                onPress={handleConfirmFreeEntry}
                                disabled={freeEntryLoading}
                                activeOpacity={0.7}
                            >
                                {freeEntryLoading
                                    ? <ActivityIndicator size="small" color="#fff" />
                                    : <Ionicons name="checkmark" size={16} color="#fff" />}
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.freeEntryCancelBtn}
                                onPress={() => { setShowFreeEntry(false); setFreeEntry({ name: '', mrp: '', stock: '' }); }}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="close" size={16} color={COLORS.error} />
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* ── Add Unlisted Item Button ── */}
                    {!showFreeEntry && (
                        <TouchableOpacity
                            style={[styles.addUnlistedBtn, r.isSmall && { alignSelf: 'center', marginVertical: 8 }]}
                            onPress={() => setShowFreeEntry(true)}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="add-circle-outline" size={14} color={COLORS.primary} />
                            <Text style={styles.addUnlistedText}>Add Unlisted Item</Text>
                        </TouchableOpacity>
                    )}

                    {/* Inventory Alerts (Low Stock & Expiry) */}
                    <View style={{ flexDirection: 'row', gap: SPACING.md, marginHorizontal: SPACING.md, marginBottom: SPACING.md }}>

                        {/* Expiry Sub-section (Left) */}
                        <View style={{ flex: 1, backgroundColor: '#FEE2E2', borderRadius: 6, padding: SPACING.sm, borderWidth: 1, borderColor: '#FECACA' }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <Text style={{ fontSize: 12, fontWeight: '700', color: '#B91C1C' }}>EXPIRY ALERTS</Text>
                                <TouchableOpacity onPress={() => navigation.navigate('Inventory', { filter: 'expiring_soon' })}>
                                    <Text style={{ fontSize: 10, fontWeight: '600', color: '#EF4444' }}>View All</Text>
                                </TouchableOpacity>
                            </View>
                            {alertsLoading ? (
                                <ActivityIndicator size="small" color="#B91C1C" />
                            ) : alerts.filter(a => a.type === 'expiry').length > 0 ? (
                                alerts.filter(a => a.type === 'expiry').slice(0, 3).map(alert => (
                                    <View key={alert.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                                        <Text style={{ fontSize: 11, color: '#991B1B', flex: 1, paddingRight: 4 }} numberOfLines={1}>{alert.name}</Text>
                                        <Text style={{ fontSize: 11, fontWeight: '600', color: alert.isExpired ? '#991B1B' : '#B91C1C' }}>
                                            {alert.isExpired ? 'Expired' : `${alert.days} days left`}
                                        </Text>
                                    </View>
                                ))
                            ) : (
                                <Text style={{ fontSize: 10, color: '#B91C1C', opacity: 0.7 }}>No expiry alerts</Text>
                            )}
                        </View>

                        {/* Info Sub-section (Right) */}
                        <View style={{ flex: 1, backgroundColor: '#EFF6FF', borderRadius: 6, padding: SPACING.sm, borderWidth: 1, borderColor: '#BFDBFE', justifyContent: 'center' }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                                <Text style={{ fontSize: 11, color: '#1E3A8A', fontWeight: '600' }}>Bills Today:</Text>
                                <Text style={{ fontSize: 11, color: '#1E3A8A', fontWeight: '700' }}>{todayStats.totalOrders}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                                <Text style={{ fontSize: 11, color: '#1E3A8A', fontWeight: '600' }}>Today's Sale:</Text>
                                <Text style={{ fontSize: 11, color: '#1E3A8A', fontWeight: '700' }}>₹{todayStats.todaySales.toLocaleString('en-IN')}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                <Text style={{ fontSize: 11, color: '#1E3A8A', fontWeight: '600' }}>Software Used Today:</Text>
                                <Text style={{ fontSize: 11, color: '#1E3A8A', fontWeight: '700' }}>{softwareUsedTime.hours}h {softwareUsedTime.minutes}m</Text>
                            </View>
                        </View>
                    </View>

                {/* Bottom Transaction Status Panel */}
                <View style={erpStyles.statusPanel}>
                    <View style={erpStyles.statusItem}>
                        <Text style={erpStyles.statusLabel}>ITEMS:</Text>
                        <Text style={erpStyles.statusValue}>{cart.length}</Text>
                    </View>
                    <Text style={erpStyles.statusSep}>│</Text>
                    <View style={erpStyles.statusItem}>
                        <Text style={erpStyles.statusLabel}>QTY:</Text>
                        <Text style={erpStyles.statusValue}>
                            {cart.reduce((sum, item) => sum + (item.is_loose_mode ? (item.loose_tablet_count || 1) : (item.cart_quantity || 1)), 0)}
                        </Text>
                    </View>
                    <Text style={erpStyles.statusSep}>│</Text>
                    <View style={{ flex: 1 }} />
                    <Text style={erpStyles.statusLabel}>Terminal 01</Text>
                </View>

            </View>
            {/* ═══════════ MOBILE CHECKOUT & RIGHT PANE ═══════════ */}
            {r.isSmall ? (
                <View style={{ backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: COLORS.border, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.1, shadowRadius: 4, zIndex: 20 }}>
                    <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight, backgroundColor: '#EBEBEB' }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <View>
                                <Text style={{ color: '#6B807A', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>ITEMS: {cart.length} | QTY: {cart.reduce((sum, item) => sum + (item.cart_quantity || item.loose_tablet_count || 1), 0)}</Text>
                                <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }} onPress={() => setAdvancedOptionsVisible(true)}>
                                    <Text style={{ color: '#164A3B', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>OPTIONS & DETAILS</Text>
                                    <Ionicons name="chevron-down" size={12} color="#164A3B" style={{ marginLeft: 2 }} />
                                </TouchableOpacity>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                                <Text style={{ color: '#6B807A', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>NET PAYABLE</Text>
                                <Text style={{ fontSize: 20, fontWeight: '800', color: '#1A2B28' }}>₹{cartSummary.grandTotal.toFixed(2)}</Text>
                            </View>
                        </View>
                    </View>
                    <View style={{ padding: 12, paddingBottom: Platform.OS === 'ios' ? 24 : 12, backgroundColor: '#F3F5F4' }}>
                        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
                            {PAYMENT_METHODS.map((m) => (
                                <TouchableOpacity key={m.key} onPress={() => setPaymentMethod(m.key)} style={[{ flex: 1, height: 32, borderRadius: 2, borderWidth: 1, borderColor: '#C4CCCA', backgroundColor: '#F3F5F4', justifyContent: 'center', alignItems: 'center' }, paymentMethod === m.key && { backgroundColor: '#164A3B', borderColor: '#164A3B' }]}>
                                    <Text style={[{ fontSize: 11, fontWeight: '700', color: '#6B807A' }, paymentMethod === m.key && { color: '#FFFFFF' }]}>{m.label.toUpperCase()}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                        <TouchableOpacity style={{ width: '100%', height: 44, backgroundColor: cart.length === 0 ? '#C4CCCA' : '#059669', borderRadius: 2, justifyContent: 'center', alignItems: 'center' }} onPress={handleCheckout} disabled={cart.length === 0 || checkoutLoading}>
                            {checkoutLoading ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 0.5 }}>PAY ₹{cartSummary.grandTotal.toFixed(2)}  <Text style={{ fontSize: 10, fontWeight: '500', opacity: 0.7 }}>Ctrl+↵</Text></Text>}
                        </TouchableOpacity>
                    </View>
                </View>
            ) : (
            <View style={[styles.rightPane, { flex: rightFlex }]}>
                <ScrollView
                    style={{ flex: 1 }}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={[
                        { flexGrow: 1, padding: r.pick({ small: 6, medium: 8, large: 8, xlarge: 8 }), paddingBottom: 12 },
                    ]}
                    keyboardShouldPersistTaps="handled"
                >
                    {/* ── Doctor Fee ── */}
                    <View style={styles.extraFeeSection}>
                        <View style={styles.extraFeeHeader}>
                            <Ionicons name="medkit-outline" size={14} color={COLORS.primary} />
                            <Text style={styles.extraFeeTitle}>Doctor Fee</Text>
                            <Text style={styles.extraFeeNote}>(no discount)</Text>
                        </View>
                        <View style={styles.extraFeeInputWrap}>
                            <Text style={styles.extraFeeCurrency}>₹</Text>
                            <TextInput
                                style={styles.extraFeeInput}
                                value={doctorFee}
                                onChangeText={t => setDoctorFee(t.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
                                placeholder="0.00"
                                placeholderTextColor={COLORS.textMuted}
                                keyboardType="decimal-pad"
                                selectTextOnFocus
                            />
                        </View>
                    </View>

                    {/* ── OTC Products ── */}
                    <View style={styles.extraFeeSection}>
                        <View style={styles.extraFeeHeader}>
                            <Ionicons name="bag-handle-outline" size={14} color={COLORS.primary} />
                            <Text style={[styles.extraFeeTitle, { color: COLORS.primary }]}>OTC Products</Text>
                            <Text style={styles.extraFeeNote}>(no discount)</Text>
                        </View>
                        {otcItems.map((otc, idx) => (
                            <View key={idx} style={styles.otcItemRow}>
                                <TextInput
                                    style={[styles.extraFeeInput, styles.otcNameInput]}
                                    value={otc.name}
                                    onChangeText={t => {
                                        const updated = [...otcItems];
                                        updated[idx] = { ...updated[idx], name: t };
                                        setOtcItems(updated);
                                    }}
                                    placeholder="Product name"
                                    placeholderTextColor={COLORS.textMuted}
                                />
                                <View style={[styles.extraFeeInputWrap, { flex: 0.9 }]}>
                                    <Text style={styles.extraFeeCurrency}>₹</Text>
                                    <TextInput
                                        style={styles.extraFeeInput}
                                        value={otc.price}
                                        onChangeText={t => {
                                            const updated = [...otcItems];
                                            updated[idx] = { ...updated[idx], price: t.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1') };
                                            setOtcItems(updated);
                                        }}
                                        placeholder="0.00"
                                        placeholderTextColor={COLORS.textMuted}
                                        keyboardType="decimal-pad"
                                        selectTextOnFocus
                                    />
                                </View>
                                {otcItems.length > 1 && (
                                    <TouchableOpacity
                                        style={styles.otcRemoveBtn}
                                        onPress={() => setOtcItems(prev => prev.filter((_, i) => i !== idx))}
                                    >
                                        <Ionicons name="close-circle" size={16} color={COLORS.error} />
                                    </TouchableOpacity>
                                )}
                            </View>
                        ))}
                        <TouchableOpacity
                            style={styles.otcAddBtn}
                            onPress={() => setOtcItems(prev => [...prev, { name: '', price: '' }])}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="add-circle-outline" size={13} color={COLORS.primary} />
                            <Text style={styles.otcAddBtnText}>Add OTC Item</Text>
                        </TouchableOpacity>
                    </View>

                    {/* ── Totals Section ── */}
                    <View style={erpStyles.erpTotalsBox}>
                        <View style={erpStyles.erpTotalRow}>
                            <Text style={erpStyles.erpTotalLabel}>SUBTOTAL</Text>
                            <Text style={erpStyles.erpTotalValue}>₹{cartSummary.subtotal.toFixed(2)}</Text>
                        </View>
                        <View style={erpStyles.erpTotalRow}>
                            <Text style={erpStyles.erpTotalLabel}>DISCOUNT</Text>
                            <Text style={[erpStyles.erpTotalValue, cartSummary.totalDiscount > 0 && { color: COLORS.error }]}>
                                {cartSummary.totalDiscount > 0 ? `-₹${cartSummary.totalDiscount.toFixed(2)}` : '₹0.00'}
                            </Text>
                        </View>
                        <View style={erpStyles.erpTotalRow}>
                            <Text style={erpStyles.erpTotalLabel}>DOCTOR FEE</Text>
                            <Text style={erpStyles.erpTotalValue}>₹{cartSummary.doctorFee.toFixed(2)}</Text>
                        </View>
                        {cartSummary.otcTotal > 0 && (
                            <View style={erpStyles.erpTotalRow}>
                                <Text style={erpStyles.erpTotalLabel}>OTC TOTAL</Text>
                                <Text style={erpStyles.erpTotalValue}>+₹{cartSummary.otcTotal.toFixed(2)}</Text>
                            </View>
                        )}
                        <View style={erpStyles.erpGrandTotalRow}>
                            <Text style={erpStyles.erpGrandTotalLabel}>NET PAYABLE</Text>
                            <Text style={erpStyles.erpGrandTotalValue}>₹{cartSummary.grandTotal.toFixed(2)}</Text>
                        </View>
                    </View>

                    {/* ── Payment Chips ── */}
                    <View style={[styles.payChipsRow, { marginBottom: 8, gap: 4 }]}>
                        {PAYMENT_METHODS.map((m) => (
                            <TouchableOpacity
                                key={m.key}
                                style={[
                                    styles.payChip,
                                    { height: 32, borderRadius: 2, borderWidth: 1, borderColor: '#C4CCCA', backgroundColor: '#F3F5F4' },
                                    paymentMethod === m.key && { backgroundColor: '#164A3B', borderColor: '#164A3B' },
                                ]}
                                onPress={() => setPaymentMethod(m.key)}
                                activeOpacity={0.7}
                            >
                                <Text style={[
                                    styles.payChipText,
                                    { fontSize: 11, fontWeight: '600', color: '#6B807A' },
                                    paymentMethod === m.key && { color: '#FFFFFF' },
                                ]}>
                                    {m.label.toUpperCase()}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* ── Pay Button ── */}
                    <TouchableOpacity
                        style={[
                            styles.payBtn,
                            { borderRadius: 2, height: 40, backgroundColor: '#059669' },
                            cart.length === 0 && styles.payBtnDisabled
                        ]}
                        onPress={handleCheckout}
                        disabled={cart.length === 0 || checkoutLoading}
                        activeOpacity={0.8}
                    >
                        {checkoutLoading ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                            <Text style={[styles.payBtnText, { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 }]}>
                                PAY ₹{cartSummary.grandTotal.toFixed(2)}  <Text style={{ fontSize: 10, fontWeight: '500', opacity: 0.7 }}>F9</Text>
                            </Text>
                        )}
                    </TouchableOpacity>

                    {/* ── Recent Activity ── */}
                    <View style={erpStyles.erpRecentBox}>
                        <View style={erpStyles.erpRecentHeader}>
                            <Text style={erpStyles.erpRecentHeaderText}>RECENT ACTIVITY</Text>
                        </View>
                            {recentSalesLoading ? (
                                <ActivityIndicator size="small" color="#059669" style={{ marginVertical: 12 }} />
                            ) : recentSales.length > 0 ? (
                                recentSales.slice(0, 5).map((sale, idx) => {
                                    const invNo = sale.invoice_number ? `#${sale.invoice_number}` : (sale._id ? `#${sale._id.slice(-6).toUpperCase()}` : `INV-${idx}`);
                                    const amount = Number(sale.grand_total || sale.total || 0).toFixed(2);
                                    return (
                                        <View key={sale._id || idx} style={erpStyles.erpRecentItem}>
                                            <Text style={erpStyles.erpTotalLabel}>{invNo}</Text>
                                            <Text style={[erpStyles.erpTotalValue, { color: '#059669' }]}>₹{amount}</Text>
                                        </View>
                                    );
                                })
                            ) : (
                                <Text style={{ fontSize: 10, color: COLORS.textMuted, textAlign: 'center', paddingVertical: 12 }}>No recent activity</Text>
                            )}
                        </View>

                </ScrollView>
            </View>
            )}

            {/* Advanced Options Modal */}
            <Modal visible={advancedOptionsVisible} animationType="slide" transparent={true} onRequestClose={() => setAdvancedOptionsVisible(false)}>
                 <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
                      <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85%' }}>
                           <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
                               <Text style={{ fontSize: 18, fontWeight: '700' }}>Options & Fees</Text>
                               <TouchableOpacity onPress={() => setAdvancedOptionsVisible(false)} hitSlop={{top:10, bottom:10, left:10, right:10}}>
                                   <Ionicons name="close-circle" size={24} color={COLORS.textMuted} />
                               </TouchableOpacity>
                           </View>
                           <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
                               <View style={styles.extraFeeSection}>
                                   <View style={styles.extraFeeHeader}>
                                       <Ionicons name="medkit-outline" size={14} color={COLORS.primary} />
                                       <Text style={styles.extraFeeTitle}>Doctor Fee</Text>
                                       <Text style={styles.extraFeeNote}>(no discount)</Text>
                                   </View>
                                   <View style={styles.extraFeeInputWrap}>
                                       <Text style={styles.extraFeeCurrency}>₹</Text>
                                       <TextInput style={styles.extraFeeInput} value={doctorFee} onChangeText={t => setDoctorFee(t.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))} placeholder="0.00" placeholderTextColor={COLORS.textMuted} keyboardType="decimal-pad" />
                                   </View>
                               </View>
                               <View style={[erpStyles.erpTotalsBox, { marginTop: 16 }]}>
                                   <View style={erpStyles.erpTotalRow}><Text style={erpStyles.erpTotalLabel}>SUBTOTAL</Text><Text style={erpStyles.erpTotalValue}>₹{cartSummary.subtotal.toFixed(2)}</Text></View>
                                   <View style={erpStyles.erpTotalRow}><Text style={erpStyles.erpTotalLabel}>DISCOUNT</Text><Text style={[erpStyles.erpTotalValue, cartSummary.totalDiscount > 0 && { color: COLORS.error }]}>{cartSummary.totalDiscount > 0 ? `-₹${cartSummary.totalDiscount.toFixed(2)}` : '₹0.00'}</Text></View>
                                   <View style={erpStyles.erpTotalRow}><Text style={erpStyles.erpTotalLabel}>OTC TOTAL</Text><Text style={erpStyles.erpTotalValue}>₹{cartSummary.otcTotal.toFixed(2)}</Text></View>
                               </View>
                           </ScrollView>
                      </View>
                 </View>
            </Modal>

            </View>



            {/* ═══════════ PAYMENT MODAL (Credit System) ═══════════ */}
            <PaymentModal
                visible={paymentModalVisible}
                onClose={() => setPaymentModalVisible(false)}
                onConfirm={processPayment}
                grandTotal={cartSummary.grandTotal}
                customerCredit={customerCredit}
                customerName={selectedCustomer?.name || selectedCustomer?.customer_name || ''}
            />

            {/* ═══════════ PRINT / SAVE MODAL ═══════════ */}
            <Modal
                visible={printModalVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setPrintModalVisible(false)}
            >
                <View style={printStyles.overlay}>
                    <View style={printStyles.card}>
                        <View style={printStyles.iconCircle}>
                            <Ionicons name="checkmark-circle" size={48} color={COLORS.success} />
                        </View>

                        <Text style={printStyles.heading}>Transaction Successful</Text>
                        <Text style={printStyles.sub}>
                            Your sale has been securely recorded to the ledger.{`\n`}Choose how you want to proceed.
                        </Text>

                        <View style={printStyles.divider} />

                        <View style={printStyles.optionRow}>
                            <TouchableOpacity
                                style={[printStyles.optionBtn, printStyles.optionPrint]}
                                onPress={handlePrintAndSave}
                                activeOpacity={0.8}
                            >
                                <View style={printStyles.optionIconWrap}>
                                    <Ionicons name="print-outline" size={24} color="#2DD4BF" />
                                </View>
                                <Text style={printStyles.optionLabel}>Print Bill</Text>
                                <Text style={printStyles.optionSub}>Opens print  •  Press <Text style={{ fontWeight: '700' }}>P</Text></Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[printStyles.optionBtn, printStyles.optionSave]}
                                onPress={handleSaveOnly}
                                activeOpacity={0.8}
                            >
                                <View style={[printStyles.optionIconWrap, printStyles.optionIconSave]}>
                                    <Ionicons name="save-outline" size={24} color="#FFFFFF" />
                                </View>
                                <Text style={[printStyles.optionLabel, printStyles.optionLabelSave]}>Save Only</Text>
                                <Text style={printStyles.optionSub}>No print  •  Press <Text style={{ fontWeight: '700' }}>S</Text></Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Last Purchase Confirmation Modal */}
            <Modal visible={lastPurchaseModalVisible} transparent animationType="fade" onRequestClose={() => setLastPurchaseModalVisible(false)}>
                <View style={pmStyles.overlay}>
                    <View style={[pmStyles.container, { maxWidth: 440 }]}>
                        <View style={pmStyles.header}>
                            <View style={{ flex: 1 }}>
                                <Text style={pmStyles.headerTitle}>Last Purchase Found</Text>
                                <Text style={pmStyles.headerSub}>Auto-fill cart with previous order?</Text>
                            </View>
                            <TouchableOpacity onPress={() => { setLastPurchaseModalVisible(false); setPendingLastItems(null); }} style={pmStyles.closeBtn}>
                                <Ionicons name="close" size={20} color={COLORS.textMuted} />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ paddingVertical: SPACING.sm }} showsVerticalScrollIndicator={false}>
                            {(pendingLastItems || []).map((item, idx) => {
                                const prod = item.product_id || {};
                                const isObj = typeof prod === 'object';
                                const stock = isObj ? (prod.quantity ?? prod.stock ?? 0) : 0;
                                const name = item.medicine_name || item.product_name || item.name || (isObj ? (prod.medicine_name || prod.product_name || prod.name) : 'Unknown');
                                const qty = item.quantity || item.cart_quantity || 1;
                                const isOut = stock <= 0;

                                return (
                                    <View key={idx} style={{
                                        flexDirection: 'row', alignItems: 'center',
                                        paddingHorizontal: SPACING.md, paddingVertical: 10,
                                        borderBottomWidth: 0.5, borderBottomColor: COLORS.borderLight,
                                        backgroundColor: isOut ? '#fef2f2' : '#fff',
                                        opacity: isOut ? 0.7 : 1,
                                    }}>
                                        <View style={{
                                            width: 26, height: 26, borderRadius: 4,
                                            backgroundColor: isOut ? COLORS.errorLight : '#dcfce7',
                                            alignItems: 'center', justifyContent: 'center', marginRight: 10,
                                        }}>
                                            <Ionicons
                                                name={isOut ? 'close-circle' : 'checkmark-circle'}
                                                size={16}
                                                color={isOut ? COLORS.error : '#16A34A'}
                                            />
                                        </View>

                                        <View style={{ flex: 1 }}>
                                            <Text style={{
                                                fontSize: FONT_SIZES.sm, fontWeight: '500',
                                                color: isOut ? COLORS.textMuted : COLORS.textPrimary,
                                                textDecorationLine: isOut ? 'line-through' : 'none',
                                            }} numberOfLines={1}>{name}</Text>
                                            <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 1 }}>
                                                Qty: {qty} • ₹{(item.mrp || item.price || 0).toFixed(2)}
                                            </Text>
                                        </View>

                                        {isOut ? (
                                            <View style={{
                                                backgroundColor: COLORS.error, paddingHorizontal: 8,
                                                paddingVertical: 3, borderRadius: 4,
                                            }}>
                                                <Text style={{ color: '#fff', fontSize: 9, fontWeight: '500', letterSpacing: 0.5 }}>OUT OF STOCK</Text>
                                            </View>
                                        ) : (
                                            <View style={{
                                                backgroundColor: '#dcfce7', paddingHorizontal: 8,
                                                paddingVertical: 3, borderRadius: 4,
                                            }}>
                                                <Text style={{ color: '#16A34A', fontSize: 9, fontWeight: '500' }}>IN STOCK ({stock})</Text>
                                            </View>
                                        )}
                                    </View>
                                );
                            })}
                        </ScrollView>

                        {/* Summary strip */}
                        {(() => {
                            const items = pendingLastItems || [];
                            const inStockCount = items.filter(item => {
                                const prod = item.product_id || {};
                                const isObj = typeof prod === 'object';
                                return (isObj ? (prod.quantity ?? prod.stock ?? 0) : 0) > 0;
                            }).length;
                            const outCount = items.length - inStockCount;

                            return (
                                <View style={{
                                    flexDirection: 'row', justifyContent: 'center', gap: 12,
                                    paddingVertical: 8, backgroundColor: COLORS.bgSurface,
                                    borderTopWidth: 0.5, borderTopColor: COLORS.borderLight,
                                }}>
                                    <Text style={{ fontSize: 11, fontWeight: '500', color: '#16A34A' }}>
                                        <Ionicons name="checkmark-circle" size={12} color="#16A34A" /> {inStockCount} available
                                    </Text>
                                    {outCount > 0 && (
                                        <Text style={{ fontSize: 11, fontWeight: '500', color: COLORS.error }}>
                                            <Ionicons name="close-circle" size={12} color={COLORS.error} /> {outCount} out of stock
                                        </Text>
                                    )}
                                </View>
                            );
                        })()}

                        <View style={pmStyles.actions}>
                            <TouchableOpacity
                                style={pmStyles.cancelBtn}
                                onPress={() => { setLastPurchaseModalVisible(false); setPendingLastItems(null); }}
                                activeOpacity={0.7}
                            >
                                <Text style={pmStyles.cancelText}>Skip</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[pmStyles.confirmBtn, (() => {
                                    const items = pendingLastItems || [];
                                    const hasAnyStock = items.some(item => {
                                        const prod = item.product_id || {};
                                        const isObj = typeof prod === 'object';
                                        return (isObj ? (prod.quantity ?? prod.stock ?? 0) : 0) > 0;
                                    });
                                    return !hasAnyStock && pmStyles.confirmDisabled;
                                })()]}
                                disabled={!(pendingLastItems || []).some(item => {
                                    const prod = item.product_id || {};
                                    const isObj = typeof prod === 'object';
                                    return (isObj ? (prod.quantity ?? prod.stock ?? 0) : 0) > 0;
                                })}
                                onPress={() => {
                                    if (pendingLastItems) {
                                        const skippedItems = [];
                                        const reorderedCart = [];

                                        pendingLastItems.forEach((item) => {
                                            const prod = item.product_id || {};
                                            const isObj = typeof prod === 'object';
                                            const stock = isObj ? (prod.quantity ?? prod.stock ?? 0) : 0;
                                            const name = item.medicine_name || item.product_name || item.name || (isObj ? (prod.medicine_name || prod.product_name || prod.name) : 'Unknown Product');
                                            const wantedQty = item.quantity || item.cart_quantity || 1;

                                            if (stock <= 0) {
                                                skippedItems.push(name);
                                                return;
                                            }

                                            reorderedCart.push({
                                                _id: isObj ? (prod._id || prod.id) : prod,
                                                product_id: isObj ? (prod._id || prod.id) : prod,
                                                medicine_name: name,
                                                barcode: item.short_barcode || item.barcode || (isObj ? (prod.short_barcode || prod.barcode) : undefined),
                                                mrp: item.mrp || item.price || (isObj ? (prod.mrp || prod.selling_price || prod.price) : 0),
                                                cart_quantity: Math.min(wantedQty, stock),
                                                discount_percent: item.discount_percent || DEFAULT_DISCOUNT,
                                                available_stock: stock,
                                            });
                                        });

                                        setCart(reorderedCart);

                                        if (skippedItems.length > 0) {
                                            Alert.alert(
                                                'Some Items Skipped',
                                                `Out of stock:\n\n• ${skippedItems.join('\n• ')}`,
                                                [{ text: 'OK' }]
                                            );
                                        }
                                    }
                                    setLastPurchaseModalVisible(false);
                                    setPendingLastItems(null);
                                }}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="cart" size={18} color="#fff" />
                                <Text style={pmStyles.confirmText}>
                                    {(() => {
                                        const items = pendingLastItems || [];
                                        const inStockCount = items.filter(item => {
                                            const prod = item.product_id || {};
                                            const isObj = typeof prod === 'object';
                                            return (isObj ? (prod.quantity ?? prod.stock ?? 0) : 0) > 0;
                                        }).length;
                                        return inStockCount > 0 ? `Add ${inStockCount} Item${inStockCount > 1 ? 's' : ''} to Cart` : 'All Out of Stock';
                                    })()}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* FEFO Warning Modal */}
            <Modal visible={fefoWarningVisible} transparent animationType="fade" onRequestClose={() => setFefoWarningVisible(false)}>
                <View style={pmStyles.overlay}>
                    <View style={[pmStyles.container, { maxWidth: 380, alignItems: 'center', paddingTop: 30 }]}>
                        <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: '#fef2f2', justifyContent: 'center', alignItems: 'center', marginBottom: 15 }}>
                            <Ionicons name="warning" size={32} color={COLORS.error} />
                        </View>
                        <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 8 }}>{fefoWarningTitle}</Text>
                        <Text style={{ fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', marginBottom: 24, lineHeight: 20 }}>{fefoWarningMessage}</Text>
                        <TouchableOpacity 
                            style={{ width: '100%', height: 44, backgroundColor: COLORS.error, borderRadius: 8, justifyContent: 'center', alignItems: 'center' }}
                            onPress={() => setFefoWarningVisible(false)}
                        >
                            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>I Understand</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            <RecommendationWidget />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: COLORS.bgDark,
    },
    leftPane: {
        flex: 1,
        backgroundColor: COLORS.white,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.border,
        minWidth: 0,
    },

    inputBarRow: {
        flexDirection: 'row',
        backgroundColor: COLORS.bgSurface,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
        height: 34,
        alignItems: 'center',
        position: 'relative',
        zIndex: 1000,
    },
    inputBarCell: {
        flex: 1,
        height: '100%',
        justifyContent: 'center',
    },
    selectedCustomerBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: SPACING.md,
        height: '100%',
    },
    selectedCustomerText: {
        fontSize: FONT_SIZES.sm,
        fontWeight: '500',
        color: COLORS.primary,
        marginRight: 4,
    },
    selectedCustomerPhone: {
        fontSize: FONT_SIZES.xs,
        fontWeight: '500',
        color: COLORS.textMuted,
    },
    inlineInputBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: SPACING.md,
        height: '100%',
    },
    inlineInput: {
        flex: 1,
        fontSize: FONT_SIZES.sm,
        fontWeight: '400',
        color: COLORS.textPrimary,
        height: '100%',
        ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
    },
    searchRelativeWrap: {
        position: 'relative',
        zIndex: 100,
        flex: 1,
        height: '100%',
    },
    floatingDropdown: {
        position: 'absolute',
        top: 42,
        left: 0,
        right: 0,
        backgroundColor: COLORS.white,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        borderRadius: RADIUS.md,
        zIndex: 9999,
        overflow: 'hidden',
    },
    dropdownItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 6,
        paddingHorizontal: SPACING.lg,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderLight,
        minHeight: 42,
    },
    dropdownName: {
        fontSize: FONT_SIZES.md,
        fontWeight: '500',
        color: COLORS.textPrimary,
    },
    dropdownMeta: {
        fontSize: FONT_SIZES.xs,
        color: COLORS.textMuted,
        marginTop: 2,
    },
    dropdownPrice: {
        fontSize: FONT_SIZES.md,
        fontWeight: '500',
        color: COLORS.primary,
    },
    tableContainer: {
        flex: 1,
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
        height: 46,
    },
    td: {
        fontSize: 12,
        color: COLORS.textSecondary,
    },
    tdCell: {
        justifyContent: 'center',
        paddingHorizontal: 8,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.border,
    },
    tdName: {
        fontSize: 13,
        fontWeight: '500',
        color: COLORS.textPrimary,
        flex: 1,
        marginRight: 4,
    },
    tdSub: {
        fontSize: 10,
        color: COLORS.textMuted,
        marginTop: 1,
    },
    tdAmount: {
        fontSize: 12,
        fontWeight: '700',
        color: COLORS.textPrimary,
    },
    qtyCell: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        columnGap: 4,
    },
    qtyBtn: {
        width: 24,
        height: 24,
        borderRadius: RADIUS.sm,
        backgroundColor: COLORS.primaryGhost,
        borderWidth: 0.5,
        borderColor: COLORS.primary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    qtyEditInput: {
        width: 32,
        height: 24,
        fontSize: 12,
        fontWeight: '500',
        color: COLORS.primary,
        textAlign: 'center',
        borderWidth: 0.5,
        borderColor: COLORS.primary,
        borderRadius: RADIUS.sm,
        backgroundColor: COLORS.primaryGhost,
        padding: 0,
        margin: 0,
        ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
    },
    discCell: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 0.5,
        borderColor: COLORS.border,
        borderRadius: RADIUS.sm,
        backgroundColor: COLORS.white,
        paddingHorizontal: 4,
        height: 24,
        minWidth: 44,
    },
    discTap: {
        paddingVertical: 4,
        paddingHorizontal: 6,
        borderRadius: RADIUS.sm,
        borderWidth: 0.5,
        borderStyle: 'dashed',
        borderColor: COLORS.border,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 28,
    },
    discTapText: {
        fontSize: FONT_SIZES.xs,
        color: COLORS.textMuted,
        fontWeight: '500',
    },
    discActive: {
        borderColor: COLORS.error,
        backgroundColor: COLORS.errorLight,
    },
    discActiveText: {
        color: COLORS.error,
        fontWeight: '500',
    },
    discEditInput: {
        width: 32,
        fontSize: FONT_SIZES.xs,
        fontWeight: '500',
        color: COLORS.textMuted,
        textAlign: 'center',
        paddingVertical: 0,
        ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
        backgroundColor: 'transparent',
    },
    deleteBtn: {
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: RADIUS.sm,
    },
    emptyTable: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: SPACING.xs,
        opacity: 0.25,
    },
    emptyText: {
        fontSize: FONT_SIZES.lg,
        fontWeight: '500',
        color: COLORS.textMuted,
    },
    emptySubtext: {
        fontSize: FONT_SIZES.sm,
        color: COLORS.textMuted,
    },
    rightPane: {
    width: 200,
    backgroundColor: COLORS.bgSurface,
    padding: 10,
    borderLeftWidth: 1,
    borderLeftColor: COLORS.border,
},
    rightPanelContent: {
        flexGrow: 1,
        paddingBottom: 16,
    },
    extraFeeSection: {
        backgroundColor: COLORS.white,
        borderRadius: 2,
        padding: 6,
        marginBottom: 6,
        borderWidth: 0.5,
        borderColor: COLORS.border,
    },
    extraFeeHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginBottom: SPACING.xs,
    },
    extraFeeTitle: {
        fontSize: FONT_SIZES.xs,
        fontWeight: '500',
        color: COLORS.primary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    extraFeeNote: {
        fontSize: 9,
        color: COLORS.textMuted,
        fontWeight: '500',
        fontStyle: 'italic',
    },
    extraFeeInputWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 0.5,
        borderColor: COLORS.border,
        borderRadius: RADIUS.sm,
        paddingHorizontal: SPACING.xs,
        backgroundColor: COLORS.bgSurface,
        flex: 1,
        height: 28,
    },
    extraFeeCurrency: {
        fontSize: FONT_SIZES.md,
        fontWeight: '500',
        color: COLORS.textSecondary,
        paddingRight: 3,
    },
    extraFeeInput: {
        flex: 1,
        fontSize: FONT_SIZES.xs,
        fontWeight: '500',
        color: COLORS.textPrimary,
        paddingVertical: 0,
        height: '100%',
        ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
    },
    otcItemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.xs,
        marginBottom: SPACING.xs,
    },
    otcNameInput: {
        flex: 1.5,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        borderRadius: 2,
        paddingHorizontal: SPACING.xs,
        backgroundColor: COLORS.bgSurface,
        paddingVertical: 0,
        height: 28,
    },
    otcRemoveBtn: {
        padding: 2,
    },
    otcAddBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingVertical: 5,
        alignSelf: 'flex-start',
    },
    otcAddBtnText: {
        fontSize: FONT_SIZES.xs,
        fontWeight: '500',
        color: COLORS.primary,
    },
    totalsSection: {
        backgroundColor: COLORS.bgSurface,
        borderRadius: 2,
        padding: 6,
        marginBottom: 6,
        borderWidth: 0.5,
        borderColor: COLORS.border,
    },
    totalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    totalLabel: {
        fontSize: 12,
        fontWeight: '500',
        color: COLORS.textSecondary,
    },
    totalValue: {
        fontSize: 12,
        fontWeight: '500',
        color: COLORS.textPrimary,
    },
    grandTotalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 4,
        paddingTop: 6,
        borderTopWidth: 0.5,
        borderTopColor: COLORS.border,
    },
    grandTotalLabel: {
        fontSize: 16,
        fontWeight: '700',
        color: COLORS.textPrimary,
        textTransform: 'uppercase',
    },
    grandTotalValue: {
        fontSize: 24,
        fontWeight: '700',
        color: COLORS.primary,
    },
    itemCountText: {
        fontSize: FONT_SIZES.xs,
        color: COLORS.textMuted,
        marginTop: SPACING.xs,
        textAlign: 'right',
    },
    payChipsRow: {
        flexDirection: 'row',
        gap: 6,
        marginBottom: 8,
    },
    payChip: {
        flex: 1,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 2,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        backgroundColor: COLORS.white,
    },
    payChipActive: {
        borderColor: COLORS.primary,
        backgroundColor: COLORS.primaryGhost,
    },
    payChipText: {
        fontSize: FONT_SIZES.sm,
        fontWeight: '500',
        color: COLORS.textMuted,
    },
    payChipTextActive: {
        color: COLORS.primary,
    },
    payBtn: {
        backgroundColor: COLORS.primary,
        borderRadius: 2,
        paddingVertical: 10,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 10,
        borderWidth: 0.5,
        borderColor: COLORS.primary,
    },
    payBtnDisabled: {
        borderColor: COLORS.border,
        backgroundColor: COLORS.white,
        opacity: 0.5,
    },
    payBtnText: {
        fontSize: FONT_SIZES.sm,
        fontWeight: '700',
        color: COLORS.white,
    },
    quickActions: {
        flexDirection: 'row',
        gap: SPACING.sm,
    },
    quickBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        paddingVertical: SPACING.xs,
        borderRadius: RADIUS.md,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        backgroundColor: COLORS.bgSurface,
    },
    quickBtnText: {
        fontSize: FONT_SIZES.xs,
        fontWeight: '500',
        color: COLORS.textSecondary,
    },
    creditBadgeStrip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: COLORS.errorLight,
        borderWidth: 0.5,
        borderColor: COLORS.error,
        borderRadius: RADIUS.sm,
        paddingHorizontal: SPACING.sm,
        paddingVertical: 4,
        marginBottom: 8,
    },
    creditBadgeText: {
        fontSize: FONT_SIZES.xs,
        fontWeight: '500',
        color: COLORS.error,
    },
    mobileCartRow: {
        backgroundColor: COLORS.white,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderLight,
        padding: 12,
        gap: 10,
    },
    mobileCartTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    mobileCartName: {
        fontSize: 16,
        fontWeight: '500',
        color: COLORS.textPrimary,
        marginBottom: 2,
    },
    mobileCartControls: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: COLORS.bgInput,
        padding: 8,
        borderRadius: RADIUS.md,
        gap: 8,
    },
    mobileCartQty: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    mobileCartAmount: {
        fontSize: 18,
        fontWeight: '500',
        color: COLORS.primary,
    },
    freeEntryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: SPACING.md,
        paddingVertical: SPACING.sm,
        backgroundColor: '#fffbeb',
        borderTopWidth: 0.5,
        borderTopColor: '#fde68a',
        borderBottomWidth: 0.5,
        borderBottomColor: '#fde68a',
    },
    freeEntryInput: {
        height: 36,
        borderWidth: 0.5,
        borderColor: '#f59e0b',
        borderRadius: RADIUS.sm,
        paddingHorizontal: 8,
        fontSize: FONT_SIZES.sm,
        fontWeight: '500',
        color: COLORS.textPrimary,
        backgroundColor: COLORS.white,
        ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
    },
    freeEntryConfirmBtn: {
        width: 36,
        height: 36,
        borderRadius: RADIUS.sm,
        backgroundColor: COLORS.primary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    freeEntryCancelBtn: {
        width: 36,
        height: 36,
        borderRadius: RADIUS.sm,
        backgroundColor: COLORS.errorLight,
        borderWidth: 0.5,
        borderColor: COLORS.error,
        alignItems: 'center',
        justifyContent: 'center',
    },
    addUnlistedBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        marginHorizontal: SPACING.md,
        marginVertical: SPACING.sm,
        paddingVertical: 5,
        paddingHorizontal: SPACING.sm,
        borderRadius: RADIUS.sm,
        borderWidth: 0.5,
        borderStyle: 'dashed',
        borderColor: COLORS.primary,
        backgroundColor: COLORS.primaryGhost,
    },
    addUnlistedText: {
        fontSize: FONT_SIZES.xs,
        fontWeight: '500',
        color: COLORS.primary,
    },
});


// ═══════════════════════════════════════════════
// LOOSE TABLET STYLES
// ═══════════════════════════════════════════════
const looseStyles = StyleSheet.create({
    modePill: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 3,
        marginTop: 2,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: RADIUS.lg,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        backgroundColor: COLORS.bgSurface,
    },
    modePillLoose: {
        borderColor: '#7C3AED',
        backgroundColor: '#F5F3FF',
    },
    modePillText: {
        fontSize: 10,
        fontWeight: '500',
        color: COLORS.textMuted,
    },
    modePillTextLoose: {
        color: '#7C3AED',
    },
    infoStrip: {
        paddingHorizontal: SPACING.md,
        paddingVertical: 3,
        backgroundColor: '#F5F3FF',
        borderBottomWidth: 0.5,
        borderBottomColor: '#DDD6FE',
    },
    infoText: {
        fontSize: 11,
        color: '#7C3AED',
        fontWeight: '500',
    },
    errorStrip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: SPACING.md,
        paddingVertical: 3,
        backgroundColor: COLORS.errorLight,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.error,
    },
    errorText: {
        fontSize: 11,
        color: COLORS.error,
        fontWeight: '500',
        flex: 1,
    },
});

// ═══════════════════════════════════════════════
// PRINT / SAVE MODAL STYLES
// ═══════════════════════════════════════════════
const printStyles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    card: {
        width: '88%',
        maxWidth: 400,
        backgroundColor: '#24312E',
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
        elevation: 15,
    },
    iconCircle: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: 'rgba(255,255,255,0.05)',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    heading: {
        fontSize: 22,
        fontWeight: '600',
        color: '#FFFFFF',
        marginBottom: 8,
    },
    sub: {
        fontSize: 14,
        color: 'rgba(255,255,255,0.6)',
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 24,
    },
    divider: {
        height: 1,
        backgroundColor: 'rgba(255,255,255,0.05)',
        alignSelf: 'stretch',
        marginBottom: 24,
    },
    optionRow: {
        flexDirection: 'row',
        gap: 16,
        alignSelf: 'stretch',
    },
    optionBtn: {
        flex: 1,
        borderRadius: 12,
        paddingVertical: 16,
        paddingHorizontal: 12,
        alignItems: 'center',
        gap: 8,
        borderWidth: 1,
    },
    optionPrint: {
        backgroundColor: '#1E2923',
        borderColor: '#2DD4BF',
    },
    optionSave: {
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderColor: 'rgba(255,255,255,0.1)',
    },
    optionIconWrap: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'rgba(45,212,191,0.1)',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 4,
    },
    optionIconSave: {
        backgroundColor: 'rgba(255,255,255,0.05)',
    },
    optionLabel: {
        fontSize: 15,
        fontWeight: '600',
        color: '#2DD4BF',
    },
    optionLabelSave: {
        color: '#FFFFFF',
    },
    optionSub: {
        fontSize: 12,
        color: 'rgba(255,255,255,0.5)',
        fontWeight: '500',
    },
});

// ═══════════════════════════════════════════════
// ERP DENSITY STYLES
// ═══════════════════════════════════════════════
const erpStyles = StyleSheet.create({
    metaBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EBEBEB',
        borderBottomWidth: 1,
        borderBottomColor: '#C4CCCA',
        paddingHorizontal: 8,
        height: 22,
    },
    metaItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    metaLabel: {
        fontSize: 9,
        fontWeight: '700',
        color: '#6B807A',
        letterSpacing: 0.5,
        marginRight: 4,
    },
    metaValue: {
        fontSize: 10,
        fontWeight: '600',
        color: '#1A2B28',
    },
    metaSep: {
        fontSize: 9,
        color: '#C4CCCA',
        marginHorizontal: 8,
    },
    statusPanel: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F3F5F4',
        borderTopWidth: 1,
        borderTopColor: '#C4CCCA',
        paddingHorizontal: 12,
        height: 28,
        marginTop: 'auto',
    },
    statusItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusLabel: {
        fontSize: 10,
        fontWeight: '600',
        color: '#6B807A',
        marginRight: 4,
    },
    statusValue: {
        fontSize: 11,
        fontWeight: '700',
        color: '#1A2B28',
    },
    statusSep: {
        fontSize: 10,
        color: '#C4CCCA',
        marginHorizontal: 10,
    },
    batchStrip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F9FAFA',
        paddingVertical: 3,
        paddingHorizontal: 6,
        borderTopWidth: 0.5,
        borderTopColor: '#E2E8E5',
        marginTop: 2,
    },
    batchText: {
        fontSize: 9,
        fontWeight: '500',
        color: '#6B807A',
        marginRight: 10,
    },
    batchVal: {
        fontWeight: '600',
        color: '#1A2B28',
    },
    erpTotalsBox: {
        borderWidth: 1,
        borderColor: '#C4CCCA',
        backgroundColor: '#FFFFFF',
        marginBottom: 12,
    },
    erpTotalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderBottomWidth: 0.5,
        borderBottomColor: '#E2E8E5',
    },
    erpTotalLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: '#6B807A',
    },
    erpTotalValue: {
        fontSize: 12,
        fontWeight: '700',
        color: '#1A2B28',
    },
    erpGrandTotalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 8,
        paddingVertical: 6,
        backgroundColor: '#D1FAE5',
    },
    erpGrandTotalLabel: {
        fontSize: 13,
        fontWeight: '800',
        color: '#065F46',
    },
    erpGrandTotalValue: {
        fontSize: 16,
        fontWeight: '800',
        color: '#065F46',
    },
    erpRecentBox: {
        borderWidth: 1,
        borderColor: '#C4CCCA',
        backgroundColor: '#FFFFFF',
        marginTop: 16,
    },
    erpRecentHeader: {
        backgroundColor: '#EBEBEB',
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#C4CCCA',
    },
    erpRecentHeaderText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#6B807A',
        letterSpacing: 0.5,
    },
    erpRecentItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 6,
        paddingHorizontal: 8,
        borderBottomWidth: 0.5,
        borderBottomColor: '#E2E8E5',
    },
    dropdownBox: {
        position: 'absolute',
        top: 34,
        left: 0,
        right: 0,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#C4CCCA',
        borderRadius: 2,
        zIndex: 9999,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 5,
        overflow: 'hidden',
    },
    dropdownHeader: {
        flexDirection: 'row',
        backgroundColor: '#EBEBEB',
        borderBottomWidth: 1,
        borderBottomColor: '#C4CCCA',
        paddingVertical: 4,
        paddingHorizontal: 8,
        alignItems: 'center',
    },
    dropdownHeaderCol: {
        fontSize: 9,
        fontWeight: '700',
        color: '#6B807A',
        letterSpacing: 0.5,
    },
    dropdownRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 5,
        paddingHorizontal: 8,
        borderBottomWidth: 0.5,
        borderBottomColor: '#E2E8E5',
    },
    dropdownColText: {
        fontSize: 11,
        color: '#1A2B28',
    },
    dropdownColTextBold: {
        fontSize: 11,
        fontWeight: '700',
        color: '#1A2B28',
    },
    dropdownColTextMuted: {
        fontSize: 10,
        color: '#6B807A',
    },
});
