/** How a transfer travels. Kept apart from the services so the browser form can use it too. */
export const TRANSPORT_MODES: Record<string, string> = {
  road_own: 'By road (own vehicle)',
  road_transporter: 'By road (transporter)',
  courier: 'Courier',
  hand: 'By hand',
  rail: 'Rail',
  air: 'Air',
};
