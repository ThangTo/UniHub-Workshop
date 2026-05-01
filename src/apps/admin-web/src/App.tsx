import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginScreen } from './screens/LoginScreen';
import { WorkshopsAdminScreen } from './screens/WorkshopsAdminScreen';
import { WorkshopFormScreen } from './screens/WorkshopFormScreen';
import { WorkshopDetailAdminScreen } from './screens/WorkshopDetailAdminScreen';
import { StaffAssignmentsScreen } from './screens/StaffAssignmentsScreen';
import { ImportJobsScreen } from './screens/ImportJobsScreen';
import { RegistrationsScreen } from './screens/RegistrationsScreen';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/workshops" element={<WorkshopsAdminScreen />} />
        <Route path="/workshops/new" element={<WorkshopFormScreen mode="create" />} />
        <Route path="/workshops/:id" element={<WorkshopDetailAdminScreen />} />
        <Route path="/workshops/:id/edit" element={<WorkshopFormScreen mode="edit" />} />
        <Route path="/registrations" element={<RegistrationsScreen />} />
        <Route path="/staff-assignments" element={<StaffAssignmentsScreen />} />
        <Route
          path="/import-jobs"
          element={
            <ProtectedRoute requireRole="SYS_ADMIN">
              <ImportJobsScreen />
            </ProtectedRoute>
          }
        />
      </Route>
      <Route path="/" element={<Navigate to="/workshops" replace />} />
      <Route path="*" element={<Navigate to="/workshops" replace />} />
    </Routes>
  );
}
