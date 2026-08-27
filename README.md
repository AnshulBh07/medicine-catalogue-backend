# Medicine Catalogue Server

Backend REST API for the Medicine Catalogue project. It provides catalog management for medicines, pharmaceutical compositions, active salts, manufacturers, medical representatives (MRs), batches, and role-protected commercial pricing data.

---

## Technology Stack

- **Runtime:** Node.js 22+ (ESM modules)
- **Language:** TypeScript (`ES2022`, `NodeNext`)
- **Web Framework:** Express 5 (`5.2.1`)
- **Database:** PostgreSQL
- **ORM & Migrations:** Prisma Client & CLI (`7.10.0`) with `@prisma/adapter-pg` driver adapter
- **Validation:** Zod (`4.4.3`)
- **Password Hashing:** Argon2 (`0.45.1`)
- **JWT & Cryptography:** `jose` (`6.2.10`)
- **Logging:** Pino (`10.3.1`) & Pino-HTTP (`11.0.0`)
- **Testing:** Vitest (`4.1.11`) & Supertest (`7.2.2`)
- **Linting:** ESLint (`10.9.1`) & TypeScript-ESLint (`8.68.0`)
- **Development Tooling:** TSX (`4.23.12`) & Nodemon (`3.1.14`)

---

## Project Structure

```text
server/
├── prisma/
│   ├── migrations/          # PostgreSQL migration SQL files
│   └── schema.prisma        # Prisma schema source of truth
├── src/
│   ├── common/              # Shared errors and global type definitions
│   │   ├── errors/          # AppError class
│   │   └── types/           # Express request augmentation
│   ├── config/              # Validated environment configuration (Zod)
│   ├── lib/                 # Shared logger (Pino) and Prisma client instance
│   ├── middleware/          # Express middlewares (auth, role, validate, error)
│   ├── modules/             # Feature modules (controllers, routes, schemas, services)
│   │   ├── auth/            # Login and JWT generation
│   │   ├── batches/         # Medicine batch tracking
│   │   ├── commercial-details/ # Admin-only pricing and schemes
│   │   ├── composition-salts/  # Salt + amount + unit combinations
│   │   ├── compositions/    # Multi-salt composition master records
│   │   ├── manufacturers/   # Pharmaceutical manufacturers
│   │   ├── medicines/       # Core medicine catalogue
│   │   ├── mrs/             # Medical representatives
│   │   ├── salts/           # Active pharmaceutical ingredients
│   │   └── users/           # User management (Admin/Employee)
│   ├── routes/              # Central router mounting under /api/v1
│   ├── scripts/             # CLI utilities (create-admin)
│   ├── app.ts               # Express application configuration
│   └── server.ts            # HTTP server startup and shutdown hooks
├── tests/                   # Automated unit and integration test suite
│   ├── api.integration.test.ts # End-to-end HTTP integration tests
│   ├── auth.test.ts         # Authentication & validation unit tests
│   ├── salt.test.ts         # Salt service & authorization tests
│   ├── setup.ts             # Test environment variable configuration
│   └── global-setup.ts      # Automated isolated test database schema lifecycle
├── package.json
├── prisma.config.ts         # Prisma CLI configuration
├── tsconfig.json
└── vitest.config.ts
```

---

## Feature Modules

1. **Authentication (`/auth`):** Login using either email or phone with Argon2 verification and JWT token issuance.
2. **Users (`/users`):** Admin-managed user creation for `ADMIN` and `EMPLOYEE` accounts.
3. **Salts (`/salts`):** Master active pharmaceutical ingredient (API) catalogue.
4. **Composition Salts (`/composition-salts`):** Specific active ingredient strengths (`Salt` + `amount` + `unit`).
5. **Compositions (`/compositions`):** Combinations of one or more CompositionSalts forming a complete composition with display text.
6. **Manufacturers (`/manufacturers`):** Medicine manufacturer master records.
7. **Medical Representatives (`/mrs`):** Medical representative contact records.
8. **Medicines (`/medicines`):** Core product records linking composition, manufacturer, optional MR, dosage form, pack units, and descriptions.
9. **Batches (`/batches`):** Manufacturing batches tied to medicines with manufacturing/expiry dates.
10. **Commercial Details (`/medicines/:medicineId/commercial-details`):** Admin-only commercial pricing, MRP, purchase rates, discount percentages, schemes, and private notes.

---

## Authentication & Authorization

### Authentication

- Authentication uses **JWT access tokens** signed with HMAC-SHA256 (`jose`).
- Endpoints require the `Authorization` header with a Bearer token:
  ```text
  Authorization: Bearer <access_token>
  ```
- Public access is limited to `POST /api/v1/auth/login` and `GET /api/v1/health`. All catalogue and management endpoints require authentication.

### Authorization Roles

1. **`ADMIN`:**
   - Full read and write access across all modules.
   - User creation (`POST /api/v1/users`).
   - Catalogue mutations (Create, Update, Soft Deactivate).
   - Commercial details management (`GET`, `POST`, `PATCH /api/v1/medicines/:medicineId/commercial-details`).
   - Querying inactive catalogue records via `includeInactive=true` or `active=all`.

2. **`EMPLOYEE`:**
   - Read-only access to active catalogue records (`Medicines`, `Batches`, `Compositions`, `Salts`, `CompositionSalts`, `Manufacturers`, `MRs`).
   - Strictly forbidden from performing catalogue mutations (returns `403 FORBIDDEN`).
   - Strictly forbidden from accessing commercial pricing data (returns `403 FORBIDDEN`).
   - Cannot view inactive/soft-deleted records (returns `403 FORBIDDEN` when requesting inactive records).

### Commercial Data Security

Commercial details (`purchaseRate`, `mrp`, `discountPercent`, `scheme`, `privateNotes`, `updatedBy`) are strictly restricted to `ADMIN` users:
- Employee-accessible `Medicine` endpoints (`GET /api/v1/medicines`, `GET /api/v1/medicines/:id`) and `Batch` endpoints (`GET /api/v1/batches`, `GET /api/v1/batches/:id`) explicitly exclude commercial details from database queries and response DTOs.
- Commercial endpoints (`/api/v1/medicines/:medicineId/commercial-details`) enforce `requireRole('ADMIN')`.

---

## API Routes

All API routes are prefixed with `/api/v1`.

### Health Check

| Method | Path | Auth | Required Role | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/health` | None | None | Service & PostgreSQL database connectivity check |

### Authentication

| Method | Path | Auth | Required Role | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/auth/login` | None | None | Login with email or phone + password |

### Users

| Method | Path | Auth | Required Role | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/users` | Bearer | `ADMIN` | Create an ADMIN or EMPLOYEE user |

### Salts

| Method | Path | Auth | Required Role | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/salts` | Bearer | Any | List salts (filter by `search`, `active`) |
| `GET` | `/salts/:id` | Bearer | Any | Get salt details by UUID |
| `POST` | `/salts` | Bearer | `ADMIN` | Create a new active salt |
| `PATCH` | `/salts/:id` | Bearer | `ADMIN` | Update salt name, description, or status |
| `DELETE`| `/salts/:id` | Bearer | `ADMIN` | Soft-deactivate salt (`active = false`) |

### Composition Salts

| Method | Path | Auth | Required Role | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/composition-salts` | Bearer | Any | List composition salts (`includeInactive`) |
| `GET` | `/composition-salts/:id` | Bearer | Any | Get composition salt by UUID |
| `POST` | `/composition-salts` | Bearer | `ADMIN` | Create salt strength (requires active Salt) |
| `PATCH` | `/composition-salts/:id` | Bearer | `ADMIN` | Update composition salt fields |
| `DELETE`| `/composition-salts/:id` | Bearer | `ADMIN` | Rejects deletion (returns 409) |

### Compositions

| Method | Path | Auth | Required Role | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/compositions` | Bearer | Any | List compositions (`includeInactive`) |
| `GET` | `/compositions/:id` | Bearer | Any | Get composition with constituent salts |
| `POST` | `/compositions` | Bearer | `ADMIN` | Create composition (requires active Salts) |
| `PATCH` | `/compositions/:id` | Bearer | `ADMIN` | Update display text or constituent salts |
| `DELETE`| `/compositions/:id` | Bearer | `ADMIN` | Soft-deactivate composition |

### Manufacturers

| Method | Path | Auth | Required Role | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/manufacturers` | Bearer | Any | List manufacturers (`search`, `includeInactive`) |
| `GET` | `/manufacturers/:id` | Bearer | Any | Get manufacturer by UUID |
| `POST` | `/manufacturers` | Bearer | `ADMIN` | Create a manufacturer |
| `PATCH` | `/manufacturers/:id` | Bearer | `ADMIN` | Update manufacturer name or status |
| `DELETE`| `/manufacturers/:id` | Bearer | `ADMIN` | Soft-deactivate manufacturer |

### Medical Representatives (MRs)

| Method | Path | Auth | Required Role | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/mrs` | Bearer | Any | List MRs (`search`, `includeInactive`) |
| `GET` | `/mrs/:id` | Bearer | Any | Get MR contact details by UUID |
| `POST` | `/mrs` | Bearer | `ADMIN` | Create a medical representative |
| `PATCH` | `/mrs/:id` | Bearer | `ADMIN` | Update MR contact info or notes |
| `DELETE`| `/mrs/:id` | Bearer | `ADMIN` | Soft-deactivate MR |

### Medicines

| Method | Path | Auth | Required Role | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/medicines` | Bearer | Any | List medicines (`search`, `form`, `manufacturerId`, `mrId`, `includeInactive`) |
| `GET` | `/medicines/:id` | Bearer | Any | Get medicine product details |
| `POST` | `/medicines` | Bearer | `ADMIN` | Create medicine (requires active relations) |
| `PATCH` | `/medicines/:id` | Bearer | `ADMIN` | Update medicine product details |
| `DELETE`| `/medicines/:id` | Bearer | `ADMIN` | Soft-deactivate medicine |

### Batches

| Method | Path | Auth | Required Role | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/batches` | Bearer | Any | List batches (`medicineId`, `expiryBefore`, `expiryAfter`, `includeInactive`) |
| `GET` | `/batches/:id` | Bearer | Any | Get batch details by UUID |
| `POST` | `/batches` | Bearer | `ADMIN` | Create batch (requires active Medicine & valid dates) |
| `PATCH` | `/batches/:id` | Bearer | `ADMIN` | Update batch number or dates |

### Commercial Details

| Method | Path | Auth | Required Role | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/medicines/:medicineId/commercial-details` | Bearer | `ADMIN` | Get commercial pricing for a medicine |
| `POST` | `/medicines/:medicineId/commercial-details` | Bearer | `ADMIN` | Create commercial pricing for a medicine |
| `PATCH` | `/medicines/:medicineId/commercial-details` | Bearer | `ADMIN` | Update commercial pricing or schemes |

---

## Validation & Error Handling

All incoming request bodies, route parameters, and query parameters are validated with **Zod** middleware.

### Error Response Envelope

All application errors conform to a consistent JSON envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      {
        "code": "custom",
        "message": "Either email or phone is required",
        "path": ["identifier"]
      }
    ]
  }
}
```

### Standard Error Codes

- `VALIDATION_ERROR` (`400`): Request payload, params, or query failed validation schema.
- `AUTHENTICATION_FAILED` (`401`): Invalid identifier or password.
- `UNAUTHENTICATED` (`401`): Missing, expired, or malformed JWT token.
- `FORBIDDEN` (`403`): User does not have sufficient role permissions.
- `NOT_FOUND` / `*_NOT_FOUND` (`404`): Resource not found or inactive.
- `DUPLICATE_*` (`409`): Unique constraint violation (e.g. duplicate salt name, barcode, batch number, or identifier).
- `INACTIVE_*` / `INACTIVE_*_REFERENCE` (`409`): Operation attempted using a deactivated entity.
- `INTERNAL_SERVER_ERROR` (`500`): Unexpected server exception.

---

## Database & Prisma

- **Database:** PostgreSQL with native UUID primary keys, DECIMAL precision for quantities and financial values, and TIMESTAMP WITH TIME ZONE.
- **Schema Source of Truth:** Defined in [`prisma/schema.prisma`](file:///D:/github%20projects/medicina-catalogue/server/prisma/schema.prisma).
- **Referential Integrity:** Foreign keys enforce `onDelete: Restrict` and `onUpdate: Cascade` across relations to prevent accidental cascade deletions.
- **Configuration:** [`prisma.config.ts`](file:///D:/github%20projects/medicina-catalogue/server/prisma.config.ts) configures the Prisma CLI and loads environment variables.

---

## Environment Configuration

Configuration is validated at startup using Zod in [`src/config/env.ts`](file:///D:/github%20projects/medicina-catalogue/server/src/config/env.ts).

### Required Environment Variables

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | String | *Required* | PostgreSQL connection string |
| `JWT_SECRET` | String | *Required* (min 32 chars) | HMAC-SHA256 signing secret for access tokens |
| `JWT_EXPIRES_IN` | String | *Required* | Token expiration string (e.g. `24h`, `7d`, `1h`) |
| `NODE_ENV` | Enum | `'development'` | Environment: `development`, `production`, `test` |
| `PORT` | Integer | `3000` | HTTP port the server listens on |

### Example `.env.development`

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/medicina_catalogue?schema=public
JWT_SECRET=your-secure-jwt-secret-key-at-least-32-chars-long
JWT_EXPIRES_IN=24h
```

---

## Development Setup & Available Scripts

### Initial Setup

```bash
# 1. Install dependencies
npm install

# 2. Generate Prisma client
npm run prisma:generate

# 3. Create initial ADMIN account (interactive CLI)
npm run create-admin

# 4. Start development server (hot-reloading with tsx + nodemon)
npm run dev
```

### Available npm Scripts

| Script | Command | Purpose |
| :--- | :--- | :--- |
| `npm run dev` | `nodemon --exec tsx src/server.ts` | Start development server with file watching |
| `npm run build` | `tsc` | Compile TypeScript to `dist/` |
| `npm start` | `node dist/server.js` | Run compiled production server |
| `npm run typecheck`| `tsc --noEmit -p tsconfig.json` | Run TypeScript type checks |
| `npm run lint` | `eslint .` | Run ESLint across codebase |
| `npm test` | `vitest run` | Run automated test suite |
| `npm run test:watch`| `vitest` | Run Vitest in interactive watch mode |
| `npm run create-admin` | `tsx src/scripts/create-admin.ts` | Interactive CLI to create the first ADMIN user |
| `npm run prisma:generate` | `prisma generate` | Generate Prisma Client types |
| `npm run prisma:validate` | `prisma validate` | Validate Prisma schema syntax |

---

## Initial ADMIN Account Creation

The backend does not expose a public user registration endpoint. Initial administrator setup is done safely through the CLI script:

```bash
npm run create-admin
```

- **Interactive:** Prompts in the terminal for admin name, email (optional), phone (optional), and password.
- **Non-Interactive (CI/Automation):** Accepts `ADMIN_NAME`, `ADMIN_EMAIL` / `ADMIN_PHONE`, and `ADMIN_PASSWORD` from process environment variables.
- **Security:**
  - Hashes passwords using Argon2 before database insertion.
  - Never logs or echoes the password to output.
  - Refuses to run if an `ADMIN` account already exists in the database (prevents accidental overwrite).
  - Enforces development-only policy (`NODE_ENV === 'development'`).

---

## Automated Testing

Testing is implemented with **Vitest** and **Supertest** against an isolated PostgreSQL schema:

```bash
npm test
```

### Test Architecture

- **Global Setup (`tests/global-setup.ts`):** Automatically provisions an isolated schema (`codex_api_integration`), runs `prisma migrate deploy` cross-platform, and drops the schema upon test completion.
- **Unit Tests (`tests/auth.test.ts`, `tests/salt.test.ts`):** Validates password hashing, JWT claims, Zod schema edge cases, and service mocking.
- **Integration Tests (`tests/api.integration.test.ts`):** Tests end-to-end HTTP requests, authorization barriers, commercial data isolation, barcode normalization, and relational integrity.

---

## Security Practices

- **Password Hashing:** Argon2 hashing for all stored credentials.
- **No Plaintext Passwords:** Passwords and password hashes are never returned in user API responses or JWT payloads.
- **Log Sanitization:** Pino HTTP logger redacts authorization headers, passwords, tokens, and JWT strings.
- **Access Control:** Server-side role enforcement on every mutation and commercial endpoint.
- **Input Sanitization & Normalization:** Strict Zod parsing and trimming for all fields; empty string barcodes normalized to `null`.
- **Soft Deactivation:** Master catalogue records are soft-deactivated (`active = false`) rather than hard-deleted to preserve relational integrity with historical transactions.

---

## Current Limitations / Deferred Work

The following capabilities are intentionally deferred in the current version:

1. **Pagination:** Listing endpoints currently return all matching records without `page`, `limit`, or cursor parameters.
2. **JWT Revocation & Refresh Tokens:** Access tokens are stateless and valid until expiration. Immediate token revocation on user deactivation and refresh tokens are not implemented.
3. **Distributor API:** The `Distributor` model exists in the database schema (reserved for future procurement and invoicing features) but has no public API endpoints.
