const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Safely retrieve, clean, and validate environment variables
const rawUrl = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.trim() : '';
const SUPABASE_URL = (rawUrl && rawUrl.startsWith('http')) 
  ? rawUrl 
  : 'https://kdreucrxnjyvojayrfmh.supabase.co';

const rawKey = process.env.SUPABASE_KEY ? process.env.SUPABASE_KEY.trim() : '';
const SUPABASE_KEY = rawKey || 'sb_publishable_qX8hazONOVQvuWurUIWFwg_SHTomBzm';

// Initialize Supabase Client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// GET /api/orders - Fetch all orders from Supabase
app.get('/api/orders', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

// POST /api/orders - Insert a new order into Supabase
app.post('/api/orders', async (req, res) => {
  try {
    const newOrder = req.body;

    const { data, error } = await supabase
      .from('orders')
      .insert([
        {
          order_number: newOrder.order_number,
          customer_name: newOrder.customer_name,
          customer_phone: newOrder.customer_phone || null,
          delivery_address: newOrder.delivery_address || null,
          delivery_fee: newOrder.delivery_fee || 0,
          order_type: newOrder.order_type,
          items: newOrder.items,
          subtotal: newOrder.subtotal || null,
          total_price: newOrder.total_price || newOrder.total || 0,
          status: newOrder.status || 'new',
          notes: newOrder.notes || null
        }
      ])
      .select();

    if (error) throw error;
    res.status(201).json({ success: true, order: data[0] });
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).json({ error: 'Failed to save order' });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
