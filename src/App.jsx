import { Routes, Route, Navigate } from 'react-router-dom'
import { EnvironmentProvider } from './context/EnvironmentContext'
import LoginPage from './pages/LoginPage'
import DashboardLayout from './components/DashboardLayout'
import CamerasPage from './pages/CamerasPage'
import WaypointFollower from './pages/WaypointFollowerMap'
import WaypointRecorder from './pages/WaypointRecorderUpdated'
import NavigationPage from './pages/NavigationPage'
import HSLCamerasPage from './pages/HSLCameraPage'
import CamerasPageWebrtc from './pages/CamerasPageWebrtc'
import SystemControl from './pages/SystemControl'
import MappingPage from './pages/MappingPage'
import IndoorNavigation from './pages/IndoorNavigation'
import DeliveryControlDashboard from './pages/Deliverycontroldashboard'
import TrovMissionControl from './pages/MissionControl'
import VirtualKeyboard from './components/VirtualKeyboard'

export default function App() {
  return (
    <EnvironmentProvider>
      <Routes>
        <Route path="/" element={<DashboardLayout />}>
          <Route index element={<Navigate to="/navigation" replace />} />
          <Route path="cameras"           element={<CamerasPage />} />
          <Route path="waypoint-follower" element={<WaypointFollower />} />
          <Route path="waypoint-recorder" element={<WaypointRecorder />} />
          <Route path="navigation"        element={<NavigationPage />} />
          <Route path="hsl-cameras"       element={<HSLCamerasPage />} />
          <Route path="webrtc-cameras"    element={<CamerasPageWebrtc />} />
          <Route path="systemcontrol"     element={<SystemControl />} />
          <Route path="mapping"           element={<MappingPage />} />
          <Route path="indoor"            element={<IndoorNavigation />} />
          <Route path="mission"            element={<TrovMissionControl />} />
          <Route path="delivery"          element={<DeliveryControlDashboard />} />
        </Route>
        <Route path="*" element={<Navigate to="/navigation" replace />} />
      </Routes>
    </EnvironmentProvider>
  )
}
