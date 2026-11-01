/**
 * Coastal View Mandarmani - Roles & Permissions Authority
 * Single source of truth for Role-Based Access Control (RBAC) across UI & Server.
 */

const ROLES = {
  SUPER_ADMIN: 'Super Admin',
  MANAGER: 'Manager',
  FRONT_DESK: 'Front Desk'
};

const PERMISSIONS = {
  // Staff & User Governance
  MANAGE_USERS: 'manage_users',
  VIEW_USERS: 'view_users',
  
  // Settings & System
  MANAGE_SETTINGS: 'manage_settings',
  MANAGE_BACKUPS: 'manage_backups',
  VIEW_AUDIT_LOG: 'view_audit_log',

  // Operations: Rooms & Inventory
  VIEW_ROOMS: 'view_rooms',
  EDIT_ROOMS_AND_PRICES: 'edit_rooms_and_prices',
  DELETE_ROOMS: 'delete_rooms',
  MANAGE_SOLD_OUT: 'manage_sold_out',

  // Operations: Bookings
  VIEW_ALL_BOOKINGS: 'view_all_bookings',
  VIEW_TODAYS_BOOKINGS: 'view_todays_bookings',
  MANAGE_BOOKINGS: 'manage_bookings',
  CHECKIN_CHECKOUT: 'checkin_checkout',
  VIEW_UNMASKED_PHONE: 'view_unmasked_phone',

  // Content, Menu, Photos, Vehicles & Chatbot
  MANAGE_MENU: 'manage_menu',
  MANAGE_PHOTOS_CONTENT: 'manage_photos_content',
  MANAGE_VEHICLES: 'manage_vehicles',
  MANAGE_CHATBOT: 'manage_chatbot',

  // Finance & Invoices
  VIEW_INVOICES: 'view_invoices',
  MANAGE_INVOICES: 'manage_invoices',
  VIEW_REPORTS: 'view_reports'
};

// Role -> Permissions Mapping
const ROLE_PERMISSIONS_MAP = {
  [ROLES.SUPER_ADMIN]: Object.values(PERMISSIONS), // Everything!

  [ROLES.MANAGER]: [
    // Bookings, rooms and prices, availability and sold-out, menu, photos and content, chatbot, invoices, reports.
    // No Users, Settings, or Backup.
    PERMISSIONS.VIEW_ROOMS,
    PERMISSIONS.EDIT_ROOMS_AND_PRICES,
    PERMISSIONS.DELETE_ROOMS,
    PERMISSIONS.MANAGE_SOLD_OUT,
    PERMISSIONS.VIEW_ALL_BOOKINGS,
    PERMISSIONS.VIEW_TODAYS_BOOKINGS,
    PERMISSIONS.MANAGE_BOOKINGS,
    PERMISSIONS.CHECKIN_CHECKOUT,
    PERMISSIONS.VIEW_UNMASKED_PHONE,
    PERMISSIONS.MANAGE_MENU,
    PERMISSIONS.MANAGE_PHOTOS_CONTENT,
    PERMISSIONS.MANAGE_VEHICLES,
    PERMISSIONS.MANAGE_CHATBOT,
    PERMISSIONS.VIEW_INVOICES,
    PERMISSIONS.MANAGE_INVOICES,
    PERMISSIONS.VIEW_REPORTS
  ],

  [ROLES.FRONT_DESK]: [
    // View and manage today's bookings, check-in and check-out, view invoices, view room availability.
    // No price edits, no deletions, no content or settings, and phone numbers partly masked.
    PERMISSIONS.VIEW_ROOMS,
    PERMISSIONS.VIEW_TODAYS_BOOKINGS,
    PERMISSIONS.MANAGE_BOOKINGS,
    PERMISSIONS.CHECKIN_CHECKOUT,
    PERMISSIONS.VIEW_INVOICES,
    PERMISSIONS.MANAGE_CHATBOT
  ]
};

// Visual Matrix Definition for UI display
const PERMISSIONS_MATRIX = [
  {
    category: 'Staff & Governance',
    items: [
      { name: 'Manage Staff Accounts (Invite, Edit, Disable, Delete)', superAdmin: true, manager: false, frontDesk: false },
      { name: 'Change Roles & Reset Credentials', superAdmin: true, manager: false, frontDesk: false },
      { name: 'View Audit Logs & Security Alerts', superAdmin: true, manager: false, frontDesk: false }
    ]
  },
  {
    category: 'System & Finance Settings',
    items: [
      { name: 'Hotel & Payment Policies (Settings)', superAdmin: true, manager: false, frontDesk: false },
      { name: 'Database Backups & Exports', superAdmin: true, manager: false, frontDesk: false },
      { name: 'Revenue Reports & Financial Analytics', superAdmin: true, manager: true, frontDesk: false }
    ]
  },
  {
    category: 'Reservations & Front Desk',
    items: [
      { name: 'View & Manage Today\'s Bookings (Check-in / Check-out)', superAdmin: true, manager: true, frontDesk: true },
      { name: 'View Invoices & Guest Folios', superAdmin: true, manager: true, frontDesk: true },
      { name: 'View Room Inventory & Availability', superAdmin: true, manager: true, frontDesk: true },
      { name: 'Full Unmasked Guest Phone Numbers', superAdmin: true, manager: true, frontDesk: false },
      { name: 'Room Pricing & Rate Modifications', superAdmin: true, manager: true, frontDesk: false },
      { name: 'Room Deletions & Sold-Out Overrides', superAdmin: true, manager: true, frontDesk: false }
    ]
  },
  {
    category: 'Property Content & Services',
    items: [
      { name: 'Restaurant & Bar Menu Management', superAdmin: true, manager: true, frontDesk: false },
      { name: 'Photo Gallery & Website Content', superAdmin: true, manager: true, frontDesk: false },
      { name: 'Vehicle & Transportation Fleet', superAdmin: true, manager: true, frontDesk: false },
      { name: 'Chatbot Concierge CRM & Live Inquiries', superAdmin: true, manager: true, frontDesk: true }
    ]
  }
];

function hasPermission(role, permission) {
  if (!role || !permission) return false;
  const perms = ROLE_PERMISSIONS_MAP[role];
  return Array.isArray(perms) && perms.includes(permission);
}

function normalizeRole(roleStr) {
  if (!roleStr) return ROLES.FRONT_DESK;
  const s = String(roleStr).trim().toLowerCase();
  if (s.includes('super')) return ROLES.SUPER_ADMIN;
  if (s.includes('manager')) return ROLES.MANAGER;
  if (s.includes('front') || s.includes('desk')) return ROLES.FRONT_DESK;
  return ROLES.FRONT_DESK;
}

module.exports = {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS_MAP,
  PERMISSIONS_MATRIX,
  hasPermission,
  normalizeRole
};
