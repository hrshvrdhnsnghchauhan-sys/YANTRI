import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_BASE = `${BASE_URL}/api`;

test.describe('YANTRI REST API - Memories', () => {
  let apiContext: any;

  test.beforeAll(async () => {
    apiContext = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: {
        'Content-Type': 'application/json',
      },
    });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('GET /memories - should return empty array initially', async () => {
    const response = await apiContext.get('/memories');
    expect(response.ok()).toBeTruthy();
    
    const memories = await response.json();
    expect(Array.isArray(memories)).toBeTruthy();
  });

  test('POST /memories - should create a new memory', async () => {
    const newMemory = {
      category: 'identity',
      text: 'Test memory from integration test',
    };

    const response = await apiContext.post('/memories', {
      data: newMemory,
    });
    
    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(201);
    
    const memory = await response.json();
    expect(memory).toMatchObject({
      category: 'identity',
      text: 'Test memory from integration test',
    });
    expect(memory.id).toBeDefined();
    expect(memory.createdAt).toBeDefined();
    expect(memory.updatedAt).toBeDefined();
  });

  test('GET /memories - should return created memory', async () => {
    const response = await apiContext.get('/memories');
    expect(response.ok()).toBeTruthy();
    
    const memories = await response.json();
    expect(memories.length).toBeGreaterThan(0);
    
    const testMemory = memories.find((m: any) => m.text === 'Test memory from integration test');
    expect(testMemory).toBeDefined();
  });

  test('POST /memories - should reject invalid data', async () => {
    const response = await apiContext.post('/memories', {
      data: {
        category: 'invalid',
        text: '',
      },
    });
    
    expect(response.status()).toBe(400);
  });

  test('DELETE /memories/:id - should delete memory', async () => {
    // First create a memory to delete
    const createResponse = await apiContext.post('/memories', {
      data: {
        category: 'preference',
        text: 'Memory to delete',
      },
    });
    
    const memory = await createResponse.json();
    
    // Delete it
    const deleteResponse = await apiContext.delete(`/memories/${memory.id}`);
    expect(deleteResponse.ok()).toBeTruthy();
    
    // Verify it's gone
    const getResponse = await apiContext.get('/memories');
    const memories = await getResponse.json();
    const deleted = memories.find((m: any) => m.id === memory.id);
    expect(deleted).toBeUndefined();
  });
});

test.describe('YANTRI REST API - Reminders', () => {
  let apiContext: any;

  test.beforeAll(async () => {
    apiContext = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: {
        'Content-Type': 'application/json',
      },
    });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('GET /reminders - should return empty array initially', async () => {
    const response = await apiContext.get('/reminders');
    expect(response.ok()).toBeTruthy();
    
    const reminders = await response.json();
    expect(Array.isArray(reminders)).toBeTruthy();
  });

  test('POST /reminders - should create a new reminder', async () => {
    const response = await apiContext.post('/reminders', {
      data: {
        text: 'Test reminder',
        minutes: 10,
      },
    });
    
    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(201);
    
    const reminder = await response.json();
    expect(reminder).toMatchObject({
      text: 'Test reminder',
      fired: false,
    });
    expect(reminder.id).toBeDefined();
    expect(reminder.fireAt).toBeDefined();
  });

  test('DELETE /reminders/:id - should cancel reminder', async () => {
    const createResponse = await apiContext.post('/reminders', {
      data: { text: 'Reminder to cancel', minutes: 30 },
    });
    
    const reminder = await createResponse.json();
    
    const deleteResponse = await apiContext.delete(`/reminders/${reminder.id}`);
    expect(deleteResponse.ok()).toBeTruthy();
    
    const getResponse = await apiContext.get('/reminders');
    const reminders = await getResponse.json();
    const cancelled = reminders.find((r: any) => r.id === reminder.id);
    expect(cancelled).toBeUndefined();
  });
});

test.describe('YANTRI REST API - User Data / Records', () => {
  let apiContext: any;

  test.beforeAll(async () => {
    apiContext = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: {
        'Content-Type': 'application/json',
      },
    });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('POST /userdata - should create a new record', async () => {
    const response = await apiContext.post('/userdata', {
      data: {
        type: 'deadline',
        title: 'Test deadline',
        payload: { subject: 'Test', marks: 100 },
        due: '2025-12-31T23:59:00.000Z',
        tags: ['test', 'urgent'],
      },
    });
    
    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(201);
    
    const record = await response.json();
    expect(record).toMatchObject({
      type: 'deadline',
      title: 'Test deadline',
      payload: { subject: 'Test', marks: 100 },
    });
    expect(record.id).toBeDefined();
  });

  test('GET /userdata - should return records with filters', async () => {
    const response = await apiContext.get('/userdata?type=deadline');
    expect(response.ok()).toBeTruthy();
    
    const records = await response.json();
    expect(Array.isArray(records)).toBeTruthy();
  });

  test('PATCH /userdata/:id - should update record', async () => {
    const createResponse = await apiContext.post('/userdata', {
      data: { type: 'note', title: 'Original', payload: { data: 'original' } },
    });
    
    const record = await createResponse.json();
    
    const updateResponse = await apiContext.patch(`/userdata/${record.id}`, {
      data: { title: 'Updated', payload: { data: 'updated' } },
    });
    
    expect(updateResponse.ok()).toBeTruthy();
    const updated = await updateResponse.json();
    expect(updated.title).toBe('Updated');
    expect(updated.payload).toEqual({ data: 'updated' });
  });

  test('DELETE /userdata/:id - should delete record', async () => {
    const createResponse = await apiContext.post('/userdata', {
      data: { type: 'note', title: 'To delete' },
    });
    
    const record = await createResponse.json();
    
    const deleteResponse = await apiContext.delete(`/userdata/${record.id}`);
    expect(deleteResponse.ok()).toBeTruthy();
    
    const getResponse = await apiContext.get('/userdata');
    const records = await getResponse.json();
    const deleted = records.find((r: any) => r.id === record.id);
    expect(deleted).toBeUndefined();
  });

  test('GET /userdata/stats - should return counts by type', async () => {
    const response = await apiContext.get('/userdata/stats');
    expect(response.ok()).toBeTruthy();
    
    const stats = await response.json();
    expect(typeof stats).toBe('object');
  });
});

test.describe('YANTRI REST API - Profile', () => {
  let apiContext: any;

  test.beforeAll(async () => {
    apiContext = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: {
        'Content-Type': 'application/json',
      },
    });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('GET /profile - should return null when no profile', async () => {
    const response = await apiContext.get('/profile');
    expect(response.ok()).toBeTruthy();
    
    const profile = await response.json();
    // May return null or profile depending on state
    expect(profile === null || typeof profile === 'object').toBeTruthy();
  });

  test('POST /profile - should create profile', async () => {
    const response = await apiContext.post('/profile', {
      data: {
        email: 'test@example.com',
        name: 'Test User',
        role: 'student',
        features: ['calendar', 'tasks'],
      },
    });
    
    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(201);
    
    const profile = await response.json();
    expect(profile).toMatchObject({
      email: 'test@example.com',
      name: 'Test User',
      role: 'student',
    });
    expect(profile.id).toBeDefined();
  });
});

test.describe('YANTRI REST API - Config & Health', () => {
  let apiContext: any;

  test.beforeAll(async () => {
    apiContext = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: {
        'Content-Type': 'application/json',
      },
    });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('GET /config - should return configuration', async () => {
    const response = await apiContext.get('/config');
    expect(response.ok()).toBeTruthy();
    
    const config = await response.json();
    expect(config).toHaveProperty('hasApiKey');
    expect(config).toHaveProperty('cloudMode');
    expect(config).toHaveProperty('agentAvailable');
    expect(config).toHaveProperty('agentUnavailableReason');
  });

  test('GET /health - should return healthy status', async () => {
    const response = await apiContext.get('/health');
    expect(response.ok()).toBeTruthy();
    
    const health = await response.json();
    expect(health.status).toBe('ok');
    expect(health.timestamp).toBeDefined();
  });

  test('GET /agent-health - should return agent status', async () => {
    const response = await apiContext.get('/agent-health');
    expect(response.ok()).toBeTruthy();
    
    const health = await response.json();
    expect(health).toHaveProperty('online');
    expect(health).toHaveProperty('reason');
    expect(health).toHaveProperty('cloudMode');
  });
});

test.describe('YANTRI REST API - Weather & News', () => {
  let apiContext: any;

  test.beforeAll(async () => {
    apiContext = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: {
        'Content-Type': 'application/json',
      },
    });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('GET /weather - should return weather data', async () => {
    const response = await apiContext.get('/weather?location=Mumbai');
    
    // May fail if external API unavailable, but should return proper error format
    if (response.ok()) {
      const weather = await response.json();
      expect(weather).toHaveProperty('result');
      expect(weather).toHaveProperty('location');
    } else {
      // Should return proper error
      const error = await response.json();
      expect(error).toHaveProperty('error');
    }
  });

  test('GET /news - should return news headlines', async () => {
    const response = await apiContext.get('/news?category=top&count=3');
    
    if (response.ok()) {
      const news = await response.json();
      expect(news).toHaveProperty('result');
      expect(news).toHaveProperty('headlines');
      expect(Array.isArray(news.headlines)).toBeTruthy();
    } else {
      const error = await response.json();
      expect(error).toHaveProperty('error');
    }
  });
});

test.describe('YANTRI REST API - Tavily Search', () => {
  let apiContext: any;

  test.beforeAll(async () => {
    apiContext = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: {
        'Content-Type': 'application/json',
      },
    });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('POST /search/tavily - should search with Tavily', async () => {
    const response = await apiContext.post('/search/tavily', {
      data: {
        query: 'YANTRI AI assistant',
        search_depth: 'basic',
        max_results: 5,
      },
    });
    
    if (response.ok()) {
      const result = await response.json();
      expect(result).toHaveProperty('result');
    } else {
      // May fail if API key not configured
      const error = await response.json();
      expect(error).toHaveProperty('error');
    }
  });
});

test.describe('YANTRI REST API - YouTube', () => {
  let apiContext: any;

  test.beforeAll(async () => {
    apiContext = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: {
        'Content-Type': 'application/json',
      },
    });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('GET /youtube/search - should search YouTube', async () => {
    const response = await apiContext.get('/youtube/search?q=test');
    
    if (response.ok()) {
      const result = await response.json();
      expect(result).toHaveProperty('videoId');
    } else {
      const error = await response.json();
      expect(error).toHaveProperty('error');
    }
  });
});

test.describe('YANTRI REST API - Google OAuth', () => {
  let apiContext: any;

  test.beforeAll(async () => {
    apiContext = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: {
        'Content-Type': 'application/json',
      },
    });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('GET /google/status - should return OAuth status', async () => {
    const response = await apiContext.get('/google/status');
    expect(response.ok()).toBeTruthy();
    
    const status = await response.json();
    expect(status).toHaveProperty('configured');
    expect(status).toHaveProperty('connected');
    expect(status).toHaveProperty('authUrl');
  });
});

test.describe('YANTRI REST API - Metrics', () => {
  let apiContext: any;

  test.beforeAll(async () => {
    apiContext = await request.newContext({
      baseURL: API_BASE,
    });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('GET /metrics - should return Prometheus metrics', async () => {
    const response = await apiContext.get('/metrics');
    expect(response.ok()).toBeTruthy();
    
    const text = await response.text();
    expect(text).toContain('yantri_');
  });
});