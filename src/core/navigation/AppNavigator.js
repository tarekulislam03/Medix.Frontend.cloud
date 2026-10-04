import React from 'react';
import { ActivityIndicator, View, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AuthContext } from '../context/AuthContext';
import LoginScreen from '../../features/auth/screens/LoginScreen';
import MainLayout from '../components/MainLayout';
import AdminBillingPanel from '../../features/settings/screens/AdminBillingPanel';

const Stack = createNativeStackNavigator();

const linking = {
    prefixes:
        Platform.OS === 'web' && typeof window !== 'undefined'
            ? [window.location.origin]
            : [],
    config: {
        screens: {
            Login: 'login',
            AdminBillingPanel: 'payment/admin',
            Main: {
                path: '',
                screens: {
                    Billing: 'billing',
                    Inventory: 'inventory',
                    Customers: 'customers',
                    Returns: 'returns',
                    Purchase: 'purchase',
                    AdminPurchaseUpload: 'purchase/admin/upload',
                    AdminAutoImportBills: 'purchase/bills/auto-import',
                    AdminStores: 'admin/control',
                    Settings: 'settings',
                    SalesAnalytics: 'analytics',
                    GstFiling: 'gst-filing',
                    Invoices: 'invoices',
                    Savings: 'savings',
                    Payment: 'payment/store',
                    Performance: 'performance',
                },
            },
        },
    },
};

const LoadingScreen = () => (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A2B28' }}>
        <ActivityIndicator size="small" color="#4FA39A" />
    </View>
);

export default function AppNavigator() {
    const { isAuthenticated, isLoading } = React.useContext(AuthContext);

    if (isLoading) {
        return <LoadingScreen />;
    }

    return (
        <NavigationContainer linking={linking} fallback={<LoadingScreen />}>
            <Stack.Navigator
                screenOptions={{
                    headerShown: false,
                }}
            >
                {isAuthenticated ? (
                    <Stack.Screen
                        name="Main"
                        component={MainLayout}
                    />
                ) : (
                    <Stack.Screen
                        name="Login"
                        component={LoginScreen}
                    />
                )}
                <Stack.Screen
                    name="AdminBillingPanel"
                    component={AdminBillingPanel}
                />
            </Stack.Navigator>
        </NavigationContainer>
    );
}
