const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

// Backup current db
fs.writeFileSync(path.join(__dirname, 'data', 'db.backup-pre-inventory.json'), JSON.stringify(db, null, 2), 'utf8');

const roomUpdates = {
  'cosy-deluxe-room': {
    name: 'Cosy Deluxe Room',
    tag: 'Non-Sea Facing',
    price: 1800,
    quantity: 7
  },
  'ocean-whisper-room': {
    name: 'The Ocean Whisper Room',
    tag: 'Sea View',
    price: 2500,
    quantity: 4
  },
  'pool-haven-room': {
    name: 'The Pool Haven Room',
    tag: 'Pool View',
    price: 2200,
    quantity: 4
  },
  'palm-grove-family-suite': {
    name: 'The Palm Grove Family Suite',
    tag: 'Family Suite',
    price: 2700,
    quantity: 2
  }
};

db.rooms = (db.rooms || []).map(room => {
  if (roomUpdates[room.id]) {
    const upd = roomUpdates[room.id];
    return {
      ...room,
      name: upd.name,
      tag: upd.tag,
      price: upd.price,
      quantity: upd.quantity,
      blockedQuantity: room.blockedQuantity || 0
    };
  }
  return room;
});

// Update SEO schema price range
if (db.seo && db.seo.schema) {
  db.seo.schema.priceRange = '₹1,800 - ₹2,700';
}

fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
console.log('Successfully updated room prices, tags, and inventory in db.json!');
const summary = db.rooms.map(r => `${r.name} (${r.tag}): ₹${r.price}/night | Qty: ${r.quantity}`);
console.log(summary.join('\n'));
const totalInventory = db.rooms.reduce((acc, r) => acc + (r.quantity || 0), 0);
console.log(`Total inventory: ${totalInventory} rooms.`);
