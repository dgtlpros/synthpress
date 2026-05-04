import { LandingLayout } from "@/components/templates/LandingLayout";
import { Hero } from "@/components/organisms/Hero";
import { HowItWorks } from "@/components/organisms/HowItWorks";
import { Features } from "@/components/organisms/Features";
import { Pricing } from "@/components/organisms/Pricing";
import { Footer } from "@/components/organisms/Footer";

export default function Home() {
  return (
    <LandingLayout>
      <Hero />
      <HowItWorks />
      <Features />
      <Pricing />
      <Footer />
    </LandingLayout>
  );
}
