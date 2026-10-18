// Every quantity, recipe alternative and timing below is a fictional demo assumption.
// These are seed records, not an execution fallback. Runtime answers query FalkorDB.
export const FIXTURE_VERSION = 'kitchen-rescue-2';
export const KITCHEN_FIXTURE = {
  id: 'savora-kitchen', currentMinute: 960,
  nodes: [
    { id: 'roma-tomatoes', name: 'Roma tomatoes', kind: 'ingredient', aliases: ['roma tomatoes', 'roma tomato'], stockGrams: 0, requiredGrams: 12000, arrivalMinute: 1110, originalArrivalMinute: 840 },
    { id: 'tomato-base', name: 'Tomato base', kind: 'base', durationMinutes: 45 },
    { id: 'lasagna-filling', name: 'Lasagna filling', kind: 'preparation', durationMinutes: 30 },
    { id: 'baked-lasagna', name: 'Baked lasagna', kind: 'dish', durationMinutes: 25 },
    { id: 'gallery-dinner', name: 'Gallery dinner', kind: 'service', portions: 40, serviceMinute: 1080, bufferMinutes: 20 },
    { id: 'arrabbiata-sauce', name: 'Arrabbiata sauce', kind: 'preparation', durationMinutes: 20 },
    { id: 'penne-arrabbiata', name: 'Penne arrabbiata', kind: 'dish', durationMinutes: 15 },
    { id: 'studio-supper', name: 'Studio supper', kind: 'service', portions: 24, serviceMinute: 1140, bufferMinutes: 20 },
    { id: 'passata', name: 'Passata', kind: 'ingredient', aliases: ['passata'], stockGrams: 10000 },
    { id: 'canned-tomatoes', name: 'Canned tomatoes', kind: 'ingredient', aliases: ['canned tomatoes', 'tinned tomatoes'], stockGrams: 10000 },
    { id: 'tomorrow-lunch', name: 'Tomorrow lunch', kind: 'service', portions: 30, serviceMinute: 2160, bufferMinutes: 20 },
  ],
  supports: [
    ['roma-tomatoes', 'tomato-base'], ['tomato-base', 'lasagna-filling'],
    ['lasagna-filling', 'baked-lasagna'], ['baked-lasagna', 'gallery-dinner'],
    ['tomato-base', 'arrabbiata-sauce'], ['arrabbiata-sauce', 'penne-arrabbiata'],
    ['penne-arrabbiata', 'studio-supper'],
  ],
  alternatives: [
    // Fixed complete-batch quantities are approved for this 64-portion service plan.
    // Changing the order quantities requires a new declared recipe, not guessed scaling.
    { from: 'roma-tomatoes', to: 'passata', requiredGrams: 8000, baseDurationMinutes: 45, plannedPortions: 64, chefApproved: true },
    { from: 'roma-tomatoes', to: 'canned-tomatoes', requiredGrams: 9000, baseDurationMinutes: 45, plannedPortions: 64, chefApproved: true },
  ],
  reservations: [
    { id: 'tomorrow-passata', ingredientId: 'passata', serviceId: 'tomorrow-lunch', quantityGrams: 8000, purpose: 'Tomorrow lunch preparation', active: true },
  ],
};
