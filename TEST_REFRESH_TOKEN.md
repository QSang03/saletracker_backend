# Test Refresh Token Fix

## ⚡ **HOTFIX Applied:**

### 🐛 **Vấn đề chính được fix:**
- ✅ **Frontend không nhận được access_token từ cookies**
- ✅ **Missing semicolon trong setRefreshToken function**  
- ✅ **Thiếu logging chi tiết để debug**
- ✅ **Response validation không đầy đủ**

### 🔧 **Các fix cụ thể:**

#### 1. **Frontend Cookie Handling**
```typescript
// BEFORE (có lỗi):
document.cookie = `refresh_token=${token}; ... SameSite=Lax${secure}`;

// AFTER (đã fix):
document.cookie = `refresh_token=${token}; ... SameSite=Lax;${secure}`;
//                                                            ^-- Thêm semicolon
```

#### 2. **Enhanced Logging**
- ✅ Thêm detailed logs trong refreshToken function
- ✅ Log response validation
- ✅ Log cookie setting verification
- ✅ Log API call success/failure

#### 3. **Response Validation**
- ✅ Verify tokens được set vào cookies
- ✅ Check response structure
- ✅ Better error handling và cleanup

### 📊 **Debug Tools Created:**

#### 1. **Browser Console Debug Script**
File: `frontend/debug-refresh-token.js`
```bash
# Copy và paste vào browser console để test
```

#### 2. **React Debug Component**
File: `frontend/components/debug/RefreshTokenDebugger.tsx`
```tsx
// Import vào bất kỳ page nào để test UI
import RefreshTokenDebugger from '@/components/debug/RefreshTokenDebugger';
```

## 🧪 **Cách Test Ngay:**

### Test 1: Check Logs Backend
```bash
# Restart server và watch console logs:
npm run start:dev

# Look for these logs:
✅ [RefreshToken] New tokens generated successfully
🔍 [RefreshToken] Access token length: XXX
🔍 [RefreshToken] Returning response with keys: ['access_token', 'refresh_token']
```

### Test 2: Check Frontend Response
```bash
# Mở Browser DevTools Console và watch:
✅ [RefreshToken] API call successful
🔍 [RefreshToken] Response data keys: ['access_token', 'refresh_token']
✅ [RefreshToken] New access token received, length: XXX
🔍 [RefreshToken] Setting access token in cookies...
🔍 [RefreshToken] Access token verification: FOUND
```

### Test 3: Manual Browser Test
```javascript
// Paste vào console:
// 1. Check current cookies
document.cookie.split(';').forEach(c => console.log(c.trim()));

// 2. Test refresh function
refreshAccessToken().then(token => console.log('Token:', !!token));

// 3. Verify after refresh
document.cookie.split(';').forEach(c => {
  if(c.includes('access_token')) console.log('Found:', c.trim());
});
```

## 🚨 **Nếu vẫn lỗi "Tokens match: NO":**

### 🔧 **Root Cause Analysis:**
Dựa trên logs bạn cung cấp, tokens có cùng 50 ký tự đầu nhưng vẫn mismatch. Có thể do:

1. **Whitespace/Newline Characters**: Có ký tự vô hình ở cuối token
2. **Encoding Issues**: Token bị encode/decode không đúng
3. **Database Storage Issues**: Token bị truncate hoặc modify khi lưu
4. **Cookie Parsing Issues**: Token bị thay đổi khi parse từ cookies

### 🛠️ **Enhanced Fixes Applied:**

#### 1. **Token Trimming Everywhere**
```typescript
// Backend: Login
const cleanRefreshToken = refreshToken.trim();
await this.usersService.updateUser(updatedUser.id, {
  refreshToken: cleanRefreshToken,
});

// Backend: Refresh validation  
const storedToken = user.refreshToken.trim();
const providedToken = cleanRefreshToken; // Already trimmed

// Frontend: Cookie retrieval
const decodedValue = decodeURIComponent(value);
return decodedValue.trim(); // Trim whitespace from decoded value
```

#### 2. **Character-by-Character Debugging**
- ✅ Log exact token lengths
- ✅ Log first 100 and last 50 characters  
- ✅ Character-by-character comparison with char codes
- ✅ Detect invisible characters

#### 3. **Debug Utilities Created**
- ✅ `debug-token-utils.js` - Compare tokens in detail
- ✅ Enhanced logging in all token operations
- ✅ Automatic token cleanup on mismatch

### 🧪 **Immediate Debug Steps:**

#### Step 1: Check Current Database Token
```sql
-- Check exact token in database
SELECT id, username, LENGTH(refresh_token) as token_length, 
       SUBSTRING(refresh_token, 1, 100) as token_start,
       SUBSTRING(refresh_token, -50) as token_end
FROM users WHERE id = 16;
```

#### Step 2: Use Debug Utility
```javascript
// Copy paste vào browser console:
const { compareTokensDetailed } = require('./debug-token-utils.js');

// Get tokens from logs và compare:
const storedToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjE2L..."; // From database
const providedToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjE2L..."; // From frontend

compareTokensDetailed(storedToken, providedToken, 'Stored', 'Provided');
```

#### Step 3: Fresh Login Test
```bash
1. Logout completely (clear all cookies)
2. Login fresh to generate new tokens
3. Immediately test refresh without any other actions
4. Check if tokens match
```

### 📊 **Expected New Logs:**
```
🔍 [Login] Saving refresh token, length: XXX
🔍 [RefreshToken] Cleaned token length: XXX  
🔍 [RefreshToken] Stored token length: XXX
🔍 [RefreshToken] Provided token length: XXX
🔍 [RefreshToken] Tokens match: YES/NO
```

### 🎯 **If Still Fails:**
The issue might be database-level. Consider:
1. **Database encoding** (UTF-8 vs Latin1)
2. **Column max length** (VARCHAR vs TEXT)  
3. **Connection charset** issues
4. **ORM escaping** during save/retrieve

## 🔥 **Quick Fix Commands:**

```bash
# 1. Clear all refresh tokens (nuclear option)
UPDATE users SET refresh_token = NULL;

# 2. Restart both frontend and backend
npm run start:dev  # Backend
npm run dev        # Frontend

# 3. Fresh login và test ngay
```

## 📝 **Quick Debug Commands:**

```bash
# Backend check user refresh token
SELECT id, username, refresh_token FROM users WHERE id = USER_ID;

# Frontend check cookies
document.cookie

# Test manual cookie set
document.cookie = "test_token=abc123; path=/; SameSite=Lax"

# Test API direct
fetch('/auth/refresh', {
  method: 'POST', 
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({refreshToken: 'YOUR_TOKEN'})
}).then(r => r.json()).then(console.log)
```

## Cách test:

### Test Case 1: Refresh Token Hợp Lệ
```bash
POST /auth/refresh
{
  "refreshToken": "valid_refresh_token_here"
}

Expected: 200 OK với access_token và refresh_token mới
```

### Test Case 2: Refresh Token Không Hợp Lệ
```bash
POST /auth/refresh
{
  "refreshToken": "invalid_token"
}

Expected: 403 Forbidden với message rõ ràng
```

### Test Case 3: User Không Tồn Tại
```bash
POST /auth/refresh
{
  "refreshToken": "token_of_deleted_user"
}

Expected: 403 Forbidden với "Invalid refresh token - user not found"
```

### Test Case 4: Token Đã Hết Hạn
```bash
POST /auth/refresh
{
  "refreshToken": "expired_token"
}

Expected: 403 Forbidden, token được clear khỏi database
```

### Test Case 5: User Bị Khóa
```bash
POST /auth/refresh
{
  "refreshToken": "token_of_blocked_user"
}

Expected: 403 Forbidden với "User is blocked"
```

## Debug Steps:

1. **Kiểm tra logs trong console**:
   - Tìm các log có prefix `[RefreshToken]`
   - Xem thông tin user found, token match, user blocked

2. **Kiểm tra database**:
   ```sql
   SELECT id, username, refresh_token FROM users WHERE id = USER_ID;
   ```

3. **Verify JWT token**:
   - Decode token để kiểm tra payload
   - Verify expiration time

## Monitoring:

- Theo dõi logs để xác định pattern lỗi
- Kiểm tra số lượng refresh token failures
- Monitor database performance với text field

## Next Steps (Optional):

1. **Multiple Device Support**: Lưu array refresh tokens
2. **Token Rotation**: Auto-rotate tokens định kỳ
3. **Rate Limiting**: Giới hạn số lần refresh token
4. **Analytics**: Track refresh token usage patterns
