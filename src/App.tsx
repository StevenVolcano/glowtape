import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth.tsx'
import SignIn from './pages/SignIn.tsx'
import Home from './pages/Home.tsx'
import Production from './pages/Production.tsx'
import Profile from './pages/Profile.tsx'
import AuditionForm from './pages/AuditionForm.tsx'
import AuditionPrint from './pages/AuditionPrint.tsx'
import Operator from './pages/Operator.tsx'

export default function App() {
  const { user } = useAuth()

  if (!user) {
    return <SignIn />
  }

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/production/:id/*" element={<Production />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/audition/:id" element={<AuditionForm />} />
      <Route path="/audition/:id/print" element={<AuditionPrint />} />
      <Route path="/operator" element={<Operator />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
