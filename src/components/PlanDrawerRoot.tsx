import PlanDrawer from "@/components/PlanDrawer";
import PlanDrawerContent from "@/components/PlanDrawerContent";
import { getCurrentPlanRecipeIds } from "@/lib/mealplan/queries";

/** Server-fetches just the count needed for the toggle button badge, keeping layout.tsx itself synchronous. */
export default async function PlanDrawerRoot({ householdId }: { householdId: string }) {
  const planRecipeIds = await getCurrentPlanRecipeIds(householdId);
  return (
    <PlanDrawer count={planRecipeIds.size}>
      <PlanDrawerContent householdId={householdId} />
    </PlanDrawer>
  );
}
