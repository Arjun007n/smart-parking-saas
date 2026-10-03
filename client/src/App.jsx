import { Navigate, Route, Routes } from 'react-router-dom'
import { GuestRoute, ProtectedRoute } from './components/ProtectedRoute'
import AuthLayout from './layouts/AuthLayout'
import DashboardLayout from './layouts/DashboardLayout'
import Home from './pages/Home'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import Overview from './pages/dashboard/Overview'
import Locations from './pages/dashboard/Locations'
import Users from './pages/dashboard/Users'
import Company from './pages/dashboard/Company'
import LocationDetail from './pages/dashboard/LocationDetail'
import Vehicles from './pages/dashboard/Vehicles'
import Reports from './pages/dashboard/Reports'
import Audit from './pages/dashboard/Audit'
import Notifications from './pages/dashboard/Notifications'
import Website from './pages/dashboard/Website'
import PublicLayout from './layouts/PublicLayout'
import About from './pages/public/About'
import Product from './pages/public/Product'
import Faq from './pages/public/Faq'
import Blog from './pages/public/Blog'
import BlogPost from './pages/public/BlogPost'
import Contact from './pages/public/Contact'
import Reseller from './pages/public/Reseller'
import OperatorLayout from './layouts/OperatorLayout'
import OperatorDashboard from './pages/operator/OperatorDashboard'
import Entry from './pages/operator/Entry'
import Entries from './pages/operator/Entries'
import Exit from './pages/operator/Exit'
import Receipt from './pages/operator/Receipt'
import Collection from './pages/operator/Collection'

function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/aboutus" element={<About />} />
        <Route path="/product" element={<Product />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/blog/:slug" element={<BlogPost />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/ResellerLogin" element={<Reseller />} />
      </Route>

      <Route element={<AuthLayout />}>
        <Route element={<GuestRoute />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
        </Route>
        <Route path="/reset-password" element={<ResetPassword />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Overview />} />
          <Route path="locations" element={<Locations />} />
          <Route path="locations/:id" element={<LocationDetail />} />
          <Route path="vehicles" element={<Vehicles />} />
          <Route element={<ProtectedRoute permission="USER_MANAGE" />}>
            <Route path="users" element={<Users />} />
          </Route>
          <Route element={<ProtectedRoute permission="COMPANY_MANAGE" />}>
            <Route path="company" element={<Company />} />
            <Route path="audit" element={<Audit />} />
          </Route>
          <Route element={<ProtectedRoute permission="REPORT_VIEW" />}>
            <Route path="reports" element={<Reports />} />
          </Route>
          <Route element={<ProtectedRoute permission="LOCATION_MANAGE" />}>
            <Route path="notifications" element={<Notifications />} />
          </Route>
          <Route element={<ProtectedRoute permission="PLATFORM_MANAGE" />}>
            <Route path="website" element={<Website />} />
          </Route>
        </Route>

        <Route path="/operator" element={<OperatorLayout />}>
          <Route index element={<Navigate to="/operator/dashboard" replace />} />
          <Route path="dashboard" element={<OperatorDashboard />} />
          <Route path="vehicles" element={<Vehicles />} />
          <Route path="entries" element={<Entries />} />
          <Route path="receipt/:id" element={<Receipt />} />
          <Route element={<ProtectedRoute permission="ENTRY_CREATE" />}>
            <Route path="entry" element={<Entry />} />
          </Route>
          <Route element={<ProtectedRoute permission="EXIT_CREATE" />}>
            <Route path="exit" element={<Exit />} />
          </Route>
          <Route element={<ProtectedRoute permission="PAYMENT_COLLECT" />}>
            <Route path="collection" element={<Collection />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
