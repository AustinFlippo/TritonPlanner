import MainLayout from "./components/MainLayout";
import { HowItWorksProvider } from "./components/HowItWorks";
import { AuthProvider } from "./context/AuthContext";
import { NextQuarterOfferingsProvider } from "./context/NextQuarterOfferingsContext";

const App = () => {
  return (
    <AuthProvider>
      <NextQuarterOfferingsProvider>
        <HowItWorksProvider>
          <div className="w-full">
            <MainLayout />
          </div>
        </HowItWorksProvider>
      </NextQuarterOfferingsProvider>
    </AuthProvider>
  );
};
export default App;
