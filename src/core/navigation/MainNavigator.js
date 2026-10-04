import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import BillingScreen from '../../features/billing/screens/BillingScreen';
import InventoryScreen from '../../features/inventory/screens/InventoryScreen';
import CustomersScreen from '../../features/customer/screens/CustomersScreen';
import ReturnScreen from '../../features/billing/screens/ReturnScreen';
import AnalyticsScreen from '../../features/analytics/screens/AnalyticsScreen';
import PurchaseScreen from '../../features/purchase/screens/purchaseScreen';
import AdminPurchaseUploadScreen from '../../features/purchase/screens/AdminPurchaseUploadScreen';
import AdminAutoImportBillsScreen from '../../features/purchase/screens/AdminAutoImportBillsScreen';
import SettingsScreen from '../../features/settings/screens/SettingsScreen';
import GstFilingScreen from '../../features/gst/screens/GstFilingScreen';
import ComingSoonScreen from '../../features/misc/screens/ComingSoonScreen';
import BoredScreen from '../../features/bored/screens/BoredScreen';
import StockLedgerScreen from '../../features/stockMovement/screens/StockLedgerScreen';
import SavingsScreen from '../../features/savings/screens/SavingsScreen';
import PaymentScreen from '../../features/billing/screens/PaymentScreen';
import LegalScreen from '../../features/legal/screens/LegalScreen';
import AdminStoresScreen from '../../features/subscriptionAdmin/screens/AdminStoresScreen';
import PerformanceScreen from '../../features/performance/screens/PerformanceScreen';

const Stack = createNativeStackNavigator();

export default function MainNavigator() {
    return (
        <Stack.Navigator
            initialRouteName="Billing"
            screenOptions={{
                headerShown: false,
                animation: 'fade',
            }}
        >
            <Stack.Screen name="Billing" component={BillingScreen} />
            <Stack.Screen name="Inventory" component={InventoryScreen} />
            <Stack.Screen name="Customers" component={CustomersScreen} />
            <Stack.Screen name="Returns" component={ReturnScreen} />
            <Stack.Screen name="Purchase" component={PurchaseScreen} />
            <Stack.Screen name="AdminPurchaseUpload" component={AdminPurchaseUploadScreen} />
            <Stack.Screen name="AdminAutoImportBills" component={AdminAutoImportBillsScreen} />
            <Stack.Screen name="AdminStores" component={AdminStoresScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="SalesAnalytics" component={AnalyticsScreen} />
            <Stack.Screen name="GstFiling" component={GstFilingScreen} />
            <Stack.Screen name="Invoices">
                {() => <ComingSoonScreen screenKey="Invoices" />}
            </Stack.Screen>
            <Stack.Screen name="Bored" component={BoredScreen} />
            <Stack.Screen name="StockLedger" component={StockLedgerScreen} />
            <Stack.Screen name="Savings" component={SavingsScreen} />
            <Stack.Screen name="Payment" component={PaymentScreen} />
            <Stack.Screen name="Legal" component={LegalScreen} />
            <Stack.Screen name="Performance" component={PerformanceScreen} />
        </Stack.Navigator>
    );
}
