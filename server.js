const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Supabase with your URL and Publishable Key
const SUPABASE_URL = process.env.SUPABASE_URL || 'YOUR_SUPABASE_PROJECT_URL';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_qX8hazONOVQvuWurUIWFwg_SHTomBzm';

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
          order_type: newOrder.order_type,
          items: newOrder.items,
          total_price: newOrder.total_price
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
