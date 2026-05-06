import { getAuthUserOncePerResponse } from "@/lib/supabase/server";
import { LandingLayout } from "@/components/templates/LandingLayout";
import { Hero } from "@/components/organisms/Hero";
import { HowItWorks } from "@/components/organisms/HowItWorks";
import { Features } from "@/components/organisms/Features";
import { Pricing } from "@/components/organisms/Pricing";
import { Footer } from "@/components/organisms/Footer";

export default async function Home() {
  const {
    data: { user },
  } = await getAuthUserOncePerResponse();

  return (
    <LandingLayout user={user ? { email: user.email ?? "" } : null}>
      <Hero />
      <HowItWorks />
      <Features />
      <Pricing />
      <Footer />
    </LandingLayout>
  );
}
