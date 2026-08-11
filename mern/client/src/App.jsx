import MainLayout from "./components/MainLayout";
import { AuthProvider } from "./context/AuthContext";
import { NextQuarterOfferingsProvider } from "./context/NextQuarterOfferingsContext";

const App = () => {
  return (
    <AuthProvider>
      <NextQuarterOfferingsProvider>
        <div className="w-full">
          <MainLayout />
        </div>
      </NextQuarterOfferingsProvider>
    </AuthProvider>
  );
};
export default App;
