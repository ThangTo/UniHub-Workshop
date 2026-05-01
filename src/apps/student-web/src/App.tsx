import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginScreen } from './screens/LoginScreen';
import { RegisterScreen } from './screens/RegisterScreen';
import { WorkshopsScreen } from './screens/WorkshopsScreen';
import { WorkshopDetailScreen } from './screens/WorkshopDetailScreen';
import { MyRegistrationsScreen } from './screens/MyRegistrationsScreen';
import { PaymentScreen } from './screens/PaymentScreen';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/register" element={<RegisterScreen />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/workshops" element={<WorkshopsScreen />} />
        <Route path="/workshops/:id" element={<WorkshopDetailScreen />} />
        <Route path="/me/registrations" element={<MyRegistrationsScreen />} />
        <Route path="/payments/:id" element={<PaymentScreen />} />
      </Route>

      <Route path="/" element={<Navigate to="/workshops" replace />} />
      <Route path="*" element={<Navigate to="/workshops" replace />} />
    </Routes>
  );
}
