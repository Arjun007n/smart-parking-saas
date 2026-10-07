import { Navigate, Route, Routes } from 'react-router-dom'
import { GuestRoute, ProtectedRoute } from './components/ProtectedRoute'
import AuthLayout from './layouts/AuthLayout'
import DashboardLayout from './layouts/DashboardLayout'
import Home from './pages/Home'
import Login from './pages/auth/Login'
import GovernmentLogin from './pages/auth/GovernmentLogin'
import GovernmentLayout from './layouts/GovernmentLayout'
import GovernmentReports from './pages/government/GovernmentReports'
import Register from './pages/auth/Register'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import Overview from './pages/dashboard/Overview'
import Locations from './pages/dashboard/Locations'
import Users from './pages/dashboard/Users'
import Roles from './pages/dashboard/Roles'
import Company from './pages/dashboard/Company'
import Billing from './pages/dashboard/Billing'
import Orders from './pages/dashboard/Orders'
import OrderDetail from './pages/dashboard/OrderDetail'
import Shop from './pages/dashboard/Shop'
import LocationDetail from './pages/dashboard/LocationDetail'
import Vehicles from './pages/dashboard/Vehicles'
import Reports from './pages/dashboard/Reports'
import Audit from './pages/dashboard/Audit'
import Notifications from './pages/dashboard/Notifications'
import Hardware from './pages/dashboard/Hardware'
import Passes from './pages/dashboard/Passes'
import Wallets from './pages/dashboard/Wallets'
import WalletDetail from './pages/dashboard/WalletDetail'
import PassDetail from './pages/dashboard/PassDetail'
import Website from './pages/dashboard/Website'
import Account from './pages/Account'
import PublicLayout from './layouts/PublicLayout'
import About from './pages/public/About'
import Product from './pages/public/Product'
import Cart from './pages/public/Cart'
import Checkout from './pages/public/Checkout'
import Faq from './pages/public/Faq'
import Blog from './pages/public/Blog'
import BlogPost from './pages/public/BlogPost'
import Contact from './pages/public/Contact'
import Reseller from './pages/public/Reseller'
import { PrivacyPolicy, SitemapPage, Terms } from './pages/public/Legal'
import Book from './pages/public/Book'
import BookLocation from './pages/public/BookLocation'
import BookingStatus from './pages/public/BookingStatus'
import BookingReturn from './pages/public/BookingReturn'
import OperatorLayout from './layouts/OperatorLayout'
import OperatorDashboard from './pages/operator/OperatorDashboard'
import Entry from './pages/operator/Entry'
import Entries from './pages/operator/Entries'
import { EntryList, ExitList } from './pages/operator/SessionList'
import Exit from './pages/operator/Exit'
import Receipt from './pages/operator/Receipt'
import Collection from './pages/operator/Collection'
import OperatorWallets from './pages/operator/Wallets'

function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/aboutus" element={<About />} />
        <Route path="/product" element={<Product />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/blog/:slug" element={<BlogPost />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms-conditions" element={<Terms />} />
        <Route path="/sitemap" element={<SitemapPage />} />
        <Route path="/ResellerLogin" element={<Reseller />} />
        <Route path="/book" element={<Book />} />
        <Route path="/book/:locationId" element={<BookLocation />} />
        <Route path="/booking/return" element={<BookingReturn />} />
        <Route path="/booking/:id" element={<BookingStatus />} />
      </Route>

      <Route element={<AuthLayout />}>
        <Route element={<GuestRoute />}>
          <Route path="/login" element={<Login />} />
          <Route path="/government/login" element={<GovernmentLogin />} />
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
          <Route path="account" element={<Account />} />
          <Route path="vehicles" element={<Vehicles />} />
          <Route element={<ProtectedRoute permission="USER_MANAGE" />}>
            <Route path="users" element={<Users />} />
          </Route>
          <Route element={<ProtectedRoute permission="ROLE_MANAGE" />}>
            <Route path="roles" element={<Roles />} />
          </Route>
          <Route element={<ProtectedRoute permission="COMPANY_MANAGE" />}>
            <Route path="company" element={<Company />} />
            <Route path="billing" element={<Billing />} />
            <Route path="orders" element={<Orders />} />
            <Route path="orders/:id" element={<OrderDetail />} />
            <Route path="audit" element={<Audit />} />
          </Route>
          <Route element={<ProtectedRoute permission="PASS_MANAGE" />}>
            <Route path="passes" element={<Passes />} />
            <Route path="passes/:id" element={<PassDetail />} />
          </Route>
          <Route element={<ProtectedRoute permission="WALLET_MANAGE" />}>
            <Route path="wallets" element={<Wallets />} />
            <Route path="wallets/:id" element={<WalletDetail />} />
          </Route>
          <Route element={<ProtectedRoute permission="REPORT_VIEW" />}>
            <Route path="reports" element={<Reports />} />
          </Route>
          <Route element={<ProtectedRoute permission="LOCATION_MANAGE" />}>
            <Route path="notifications" element={<Notifications />} />
            <Route path="hardware" element={<Hardware />} />
          </Route>
          <Route element={<ProtectedRoute permission="PLATFORM_MANAGE" />}>
            <Route path="website" element={<Website />} />
            <Route path="shop" element={<Shop />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute permission="GOVERNMENT_REPORT" loginPath="/government/login" />}>
          <Route path="/government" element={<GovernmentLayout />}>
            <Route index element={<GovernmentReports />} />
          </Route>
        </Route>

        <Route path="/operator" element={<OperatorLayout />}>
          <Route index element={<Navigate to="/operator/dashboard" replace />} />
          <Route path="dashboard" element={<OperatorDashboard />} />
          <Route path="vehicles" element={<Vehicles />} />
          <Route path="account" element={<Account />} />
          <Route path="entries" element={<Entries />} />
          <Route path="entry-list" element={<EntryList />} />
          <Route path="exit-list" element={<ExitList />} />
          <Route path="receipt/:id" element={<Receipt />} />
          <Route element={<ProtectedRoute permission="ENTRY_CREATE" />}>
            <Route path="entry" element={<Entry />} />
          </Route>
          <Route element={<ProtectedRoute permission="EXIT_CREATE" />}>
            <Route path="exit" element={<Exit />} />
          </Route>
          <Route element={<ProtectedRoute permission="PAYMENT_COLLECT" />}>
            <Route path="collection" element={<Collection />} />
            <Route path="wallets" element={<OperatorWallets />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
