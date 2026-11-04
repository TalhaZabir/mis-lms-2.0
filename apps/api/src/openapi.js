const config = require('./config');

const errorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    code: { type: 'string' },
    requestId: { type: 'string' },
    details: {},
  },
};

function buildOpenApi() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'MIS LMS 2.0 API',
      version: config.version,
      description: 'API-first contract for the modular MIS LMS monolith. Existing v1 paths remain available; /v1 is the canonical prefix.',
    },
    servers: [
      { url: '/v1', description: 'Versioned API' },
      { url: '/', description: 'Backward-compatible paths' },
    ],
    tags: [
      { name: 'System' },
      { name: 'Authentication' },
      { name: 'Academic' },
      { name: 'Learning' },
      { name: 'Community' },
      { name: 'Resources' },
      { name: 'Search' },
      { name: 'Analytics' },
      { name: 'Assistant' },
    ],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Error: errorResponse,
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time' },
            user: { $ref: '#/components/schemas/User' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['SUPER_ADMIN', 'ADMIN_STAFF', 'FACULTY', 'TA', 'STUDENT', 'ALUMNI', 'MODERATOR'] },
          },
        },
        SearchResult: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['course', 'resource', 'people', 'post', 'knowledge'] },
            id: { type: 'string' },
            title: { type: 'string' },
            subtitle: { type: 'string' },
            url: { type: 'string' },
            score: { type: 'number' },
            snippet: { type: 'string' },
          },
        },
        AssistantAnswer: {
          type: 'object',
          properties: {
            answer: { type: 'string' },
            grounded: { type: 'boolean' },
            citations: { type: 'array', items: { type: 'integer' } },
            sources: { type: 'array', items: { type: 'object' } },
            provider: { type: 'string' },
            model: { type: 'string' },
            usageId: { type: 'string', nullable: true },
          },
        },
      },
    },
    paths: {
      '/health': {
        get: {
          tags: ['System'],
          summary: 'Liveness probe',
          security: [],
          responses: { 200: { description: 'Service is alive' } },
        },
      },
      '/ready': {
        get: {
          tags: ['System'],
          summary: 'Readiness probe (database connectivity)',
          security: [],
          responses: {
            200: { description: 'Ready' },
            503: { description: 'Not ready' },
          },
        },
      },
      '/auth/login': {
        post: {
          tags: ['Authentication'],
          summary: 'Create a revocable server-side session',
          security: [],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
          },
          responses: {
            200: { description: 'Session created', content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } } },
            401: { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            429: { description: 'Rate limited' },
          },
        },
      },
      '/auth/me': {
        get: {
          tags: ['Authentication'],
          summary: 'Current user',
          responses: { 200: { description: 'Current user', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
        },
      },
      '/auth/logout': {
        post: {
          tags: ['Authentication'],
          summary: 'Revoke the current session',
          responses: { 200: { description: 'Revoked' } },
        },
      },
      '/auth/sessions': {
        get: {
          tags: ['Authentication'],
          summary: 'List active sessions',
          responses: { 200: { description: 'Active sessions' } },
        },
      },
      '/search': {
        get: {
          tags: ['Search'],
          summary: 'Permission-aware global search',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2, maxLength: 120 } },
            { name: 'types', in: 'query', schema: { type: 'string', example: 'course,resource,people,post,knowledge' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 30 } },
          ],
          responses: {
            200: {
              description: 'Ranked results',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      query: { type: 'string' },
                      results: { type: 'array', items: { $ref: '#/components/schemas/SearchResult' } },
                      facets: { type: 'object' },
                      suggestions: { type: 'array', items: { type: 'string' } },
                      total: { type: 'integer' },
                      tookMs: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/me/notifications': {
        get: {
          tags: ['Community'],
          summary: 'List the current user\'s notifications',
          parameters: [
            { name: 'unread', in: 'query', schema: { type: 'string', enum: ['0', '1'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          ],
          responses: { 200: { description: 'Notifications' } },
        },
      },
      '/ai/ask': {
        post: {
          tags: ['Assistant'],
          summary: 'Ask the read-only, citation-backed assistant',
          description: 'Disabled unless AI_ENABLED=true. Never mutates grades, records, publications or permissions.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['question'],
                  properties: {
                    question: { type: 'string', minLength: 3, maxLength: 2000 },
                    courseId: { type: 'string' },
                    history: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Answer', content: { 'application/json': { schema: { $ref: '#/components/schemas/AssistantAnswer' } } } },
            403: { description: 'Assistant disabled' },
            429: { description: 'Daily quota or rate limit reached' },
          },
        },
      },
      '/me/progress': {
        get: {
          tags: ['Academic'],
          summary: 'Advisory degree progress and GPA',
          responses: { 200: { description: 'Progress' } },
        },
      },
      '/me/calendar.ics': {
        get: {
          tags: ['Learning'],
          summary: 'Personal academic calendar as iCalendar',
          responses: { 200: { description: 'text/calendar' } },
        },
      },
    },
  };
}

module.exports = { buildOpenApi };
