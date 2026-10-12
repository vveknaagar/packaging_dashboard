import type { Role } from './types';

/**
 * What each role can do, written for the people using the app. The first-login
 * tour and the User guide page are both built from this, so they never disagree.
 */
export interface GuideSection {
  id: string;
  title: string;
  /** One line for the tour bubble. */
  summary: string;
  /** Menu link the tour points at. Sections without one are only on the guide page. */
  href?: string;
  steps: string[];
  tips?: string[];
}

const ALL: Record<string, GuideSection> = {
  dashboard: {
    id: 'dashboard', href: '/', title: 'Dashboard',
    summary: 'Your starting point: stock at a glance, transfers waiting for you and recent activity.',
    steps: [
      'Open Dashboard from the menu at any time to come back here.',
      'Check the cards at the top for totals and anything that needs your attention.',
      'Click a transfer or an item in the lists to open it.',
    ],
  },
  items: {
    id: 'items', href: '/items', title: 'Items',
    summary: 'The list of packaging items with their size, unit and picture.',
    steps: [
      'Open Items to see every packaging item.',
      'Use the search box to find an item by name or size.',
      'Click a picture to see it full size.',
    ],
  },
  itemsAdmin: {
    id: 'items', href: '/items', title: 'Items',
    summary: 'Add and edit packaging items, their pictures, and upload many at once from Excel.',
    steps: [
      'Open Items and click Add item. Enter Name, Size and Unit, add a picture, and save.',
      'To change an item, click Edit next to it. To stop using one, Deactivate it (items are never deleted, so history stays).',
      'To add many items at once, click Bulk upload, download the Excel template, fill in Name, Size, Unit and Stock, and upload it.',
      'Check the preview: rows with errors are shown in red and are left out. Click Import to add the rest. The Stock column becomes opening stock in the warehouse.',
      'Items added in bulk have no picture yet. Add one later with Edit.',
    ],
  },
  stock: {
    id: 'stock', href: '/stock', title: 'Stock',
    summary: 'How much of each item you have, and where you record Stock In, Stock Out or an Adjustment.',
    steps: [
      'Open Stock to see the quantity of every item at your location.',
      'To record new stock arriving from a supplier, click Update next to the item, choose Stock In, enter the quantity and a reason, and save.',
      'To record stock used up, choose Stock Out. To correct a count, choose Adjustment and enter the real quantity.',
      'At a store, click Mark sold to record what was sold: tick each item, enter how many, enter the bill / invoice number and the customer\'s name (phone if you have it), and click Mark sold. The quantities come off the store\'s stock.',
      'Every change is saved in the Stock ledger with your name and the reason.',
    ],
    tips: ['Stock moving between locations is done with a Transfer, not with Stock In / Out.'],
  },
  matrix: {
    id: 'matrix', href: '/stock/matrix', title: 'Stock matrix',
    summary: 'Every item against every location in one table.',
    steps: [
      'Open Stock matrix to compare stock across the warehouse and all stores.',
      'Scroll sideways to see more locations. The item column stays in place.',
      'Click a location name to open its stock.',
    ],
  },
  ledger: {
    id: 'ledger', href: '/stock/ledger', title: 'Stock ledger',
    summary: 'The permanent history of every stock change: who, when, how much and why.',
    steps: [
      'Open Stock ledger to see every change, newest first.',
      'Filter by location, by type of change, or search for an item.',
      'Entries cannot be edited or deleted. A mistake is corrected with a new Adjustment.',
    ],
  },
  pricing: {
    id: 'pricing', href: '/pricing', title: 'Price & HSN',
    summary: 'Set the price and HSN code of each item. They are printed on delivery challans.',
    steps: [
      'Open Price & HSN. Type the HSN code (4, 6 or 8 digits) and the price in rupees for each item.',
      'Click Save changes. Only the rows you changed are saved.',
      'Choose "Missing price or HSN" in the filter to find items that still need one.',
    ],
    tips: ['A transfer keeps the price it had when it was dispatched, so changing a price later does not change old delivery challans.'],
  },
  transfers: {
    id: 'transfers', href: '/transfers', title: 'Transfers',
    summary: 'Every transfer in and out of your location, and the ones waiting for your approval.',
    steps: [
      'Open Transfers. Use the tabs to switch between Incoming and Outgoing, and the status filter to find a transfer.',
      'Click a transfer to see its items, the parcel photo, its timeline and the delivery challan.',
      'Click Delivery Challan to print or save it as PDF to send with the parcel.',
    ],
  },
  newTransfer: {
    id: 'new-transfer', href: '/transfers/new', title: 'Send stock (New transfer)',
    summary: 'Send stock to another location. You must add a photo of the packed parcel.',
    steps: [
      'Click New transfer and choose where the stock is going.',
      'Enter the quantity for each item you are sending. You cannot send more than you have.',
      'Choose how it is being sent (own vehicle, transporter, courier...), pick the logistic partner if a courier or transport company carries it, and add the tracking or vehicle number.',
      'Take a photo of the packed parcel and add it under Parcel photo. On a phone, this opens the camera.',
      'Click Dispatch. The stock is taken out of your location and shows as in transit. Or click Save draft to finish later.',
    ],
    tips: [
      'From a store, click Send for approval instead of Dispatch. A Warehouse Admin approves it first; then open the transfer, add the parcel photo and click Dispatch. Nothing leaves your store before that.',
      'A store can send stock to another store or back to the warehouse.',
      'Until the other side approves it, you can still cancel a dispatched transfer and the stock comes back to you.',
    ],
  },
  approveTransfers: {
    id: 'approve-transfers', title: 'Approve transfers from stores',
    summary: 'Every transfer a store sends must be approved by the warehouse before it is dispatched.',
    steps: [
      'When a store sends a transfer for approval, "to approve" appears at the top and on the Dashboard.',
      'Open the transfer and check where it is going and what is in it.',
      'Click Approve. The store can then pack it and dispatch it with a parcel photo.',
      'Or click Decline and give a reason. The transfer closes and no stock moves.',
    ],
  },
  receive: {
    id: 'receive', title: 'Receive stock (approve a transfer)',
    summary: 'When stock is sent to you, count it and approve it.',
    steps: [
      'When stock is sent to you, the bell at the top shows a number and "pending approval" appears.',
      'Open the transfer. Check the parcel photo and count what arrived.',
      'Enter the quantity actually received for each item. If anything is short or damaged, enter the real number and write a remark.',
      'Click Approve receipt. Only the received quantities are added to your stock, and the sender is told about any difference.',
      'If the delivery is completely wrong, click Reject transfer and give a reason. All the stock goes back to the sender.',
    ],
  },
  notifications: {
    id: 'notifications', title: 'Notifications',
    summary: 'The bell shows new messages about transfers sent to you or from you.',
    steps: [
      'Click the bell at the top right to see your notifications.',
      'A yellow bell means a transfer is waiting for your approval.',
      'Click a notification to open the transfer. Click "Mark all as read" to clear the count.',
    ],
  },
  locations: {
    id: 'locations', href: '/locations', title: 'Locations',
    summary: 'The warehouse and every store, with address, GSTIN and contacts.',
    steps: [
      'Open Locations to see the warehouse and all stores.',
    ],
  },
  locationsAdmin: {
    id: 'locations', href: '/locations', title: 'Locations (stores)',
    summary: 'Add stores, edit their address and GSTIN, and activate or deactivate them.',
    steps: [
      'Open Locations and click Add store. Enter the name, a short code, the address and the GSTIN.',
      'You can create the Store Admin for the new store on the same form.',
      'To stop using a store, Deactivate it. It must have no transfers in transit first.',
    ],
  },
  logistics: {
    id: 'logistics', href: '/logistics', title: 'Logistic partners',
    summary: 'The courier and transport companies senders choose from on a transfer. Only you can change this list.',
    steps: [
      'Open Logistic partners. Enter the company name, and a contact person and phone if you have them, then click Add partner.',
      'To change one, click Edit, make the change and click Save changes.',
      'If you stop using a company, Deactivate it. Senders can no longer choose it, and past transfers still show it.',
      'Senders pick the partner on the New transfer form. It is printed on the delivery challan.',
    ],
  },
  users: {
    id: 'users', href: '/users', title: 'Users',
    summary: 'Create accounts for Warehouse and Store Admins, reset passwords and deactivate users.',
    steps: [
      'Open Users and click Add user. Choose the role and, for a Store Admin, their store.',
      'Give them their username and password. They will see this tour the first time they sign in.',
      'To reset a password, Edit the user, type a new one and click Save changes. They are signed out everywhere.',
      'When someone leaves, Edit them and set their status to Inactive. They can no longer sign in, and their history stays.',
    ],
  },
  switchUser: {
    id: 'switch-user', title: 'Switch user',
    summary: 'See the app exactly as another user does, and act for them if needed.',
    steps: [
      'At the bottom of the menu, pick a person from "Switch user…".',
      'A yellow bar shows whose account you are using. Anything you do is recorded as done by you on their behalf.',
      'Click "Back to …" in the yellow bar to return to your own account.',
    ],
  },
  audit: {
    id: 'audit', href: '/audit', title: 'Audit log',
    summary: 'Every action by every user: sign-ins, items, prices, stock, transfers, stores and users.',
    steps: [
      'Open Audit log to see who did what and when, newest first.',
      'Filter by store, by user, by type of activity or by date, or search for an item, transfer number or store.',
      'Open By store and user to see each store\'s users with how many times they did each activity. Click a number to see those entries.',
      'Click Download CSV to open the filtered list, or the store and user counts, in Excel.',
      'Entries cannot be edited or deleted.',
    ],
  },
  account: {
    id: 'account', title: 'My account and signing out',
    summary: 'Change your password, switch light / dark mode, and sign out.',
    steps: [
      'Click My account at the bottom of the menu to see your details and change your password.',
      'Use the sun / moon button at the top to switch between light and dark mode.',
      'Click Sign out when you finish, especially on a shared computer.',
    ],
  },
  guide: {
    id: 'guide', href: '/guide', title: 'User guide',
    summary: 'This guide is always here. You can also take this tour again from it.',
    steps: ['Open User guide from the menu whenever you need help.'],
  },
};

const ORDER: Record<Role, string[]> = {
  super_admin: ['dashboard', 'itemsAdmin', 'stock', 'matrix', 'ledger', 'pricing', 'transfers', 'newTransfer', 'approveTransfers', 'receive',
    'notifications', 'locationsAdmin', 'users', 'logistics', 'switchUser', 'audit', 'account', 'guide'],
  warehouse_admin: ['dashboard', 'stock', 'matrix', 'ledger', 'items', 'transfers', 'newTransfer', 'approveTransfers', 'receive',
    'notifications', 'locations', 'account', 'guide'],
  store_admin: ['dashboard', 'stock', 'ledger', 'items', 'transfers', 'newTransfer', 'receive', 'notifications', 'account', 'guide'],
};

export const guideFor = (role: Role): GuideSection[] => ORDER[role].map((key) => ALL[key]);

export interface TourStep {
  title: string;
  body: string;
  /** CSS selector of what to point at. None: a message in the middle of the screen. */
  target?: string;
  /** The target is in the slide-in menu, which a phone has to open first. */
  inMenu?: boolean;
}

const WHERE: Record<string, Pick<TourStep, 'target' | 'inMenu'>> = {
  notifications: { target: '[data-tour="bell"]' },
  'switch-user': { target: '[data-tour="switcher"]', inMenu: true },
  account: { target: '[data-tour="account"]', inMenu: true },
};

/** The first-login tour: a welcome, one stop per feature, and a goodbye. */
export function tourFor(role: Role, name: string): TourStep[] {
  const steps: TourStep[] = [{
    title: `Welcome, ${name.split(' ')[0]}!`,
    body: 'This short tour shows you around Mayave Item Transfer. It takes about a minute. Use Next to move on, or Skip to close it.',
  }];
  for (const s of guideFor(role)) {
    const where = s.href ? { target: `[data-tour="${s.href}"]`, inMenu: true } : WHERE[s.id];
    if (where) steps.push({ title: s.title, body: s.summary, ...where });
  }
  steps.push({
    title: 'You are ready',
    body: 'For step-by-step help on any of these, open User guide from the menu. You can take this tour again from there.',
  });
  return steps;
}
