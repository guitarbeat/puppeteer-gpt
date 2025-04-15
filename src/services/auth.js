"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
var fs_1 = require("fs");
var path_1 = require("path");
var AuthService = /** @class */ (function () {
    function AuthService(config) {
        this.config = __assign({ loginTimeout: 30000 }, config);
    }
    /**
     * Load cookies from file if they exist
     */
    AuthService.prototype.loadCookies = function (page) {
        return __awaiter(this, void 0, void 0, function () {
            var cookiePath, cookies, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        cookiePath = this.config.cookiePath;
                        if (!fs_1.default.existsSync(cookiePath)) return [3 /*break*/, 4];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        cookies = JSON.parse(fs_1.default.readFileSync(cookiePath, 'utf8'));
                        return [4 /*yield*/, page.setCookie.apply(page, cookies)];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, true];
                    case 3:
                        error_1 = _a.sent();
                        console.warn('Failed to load cookies:', error_1);
                        return [2 /*return*/, false];
                    case 4: return [2 /*return*/, false];
                }
            });
        });
    };
    /**
     * Save cookies to file
     */
    AuthService.prototype.saveCookies = function (page) {
        return __awaiter(this, void 0, void 0, function () {
            var cookiePath, cookies, dir;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        cookiePath = this.config.cookiePath;
                        return [4 /*yield*/, page.cookies()];
                    case 1:
                        cookies = _a.sent();
                        dir = path_1.default.dirname(cookiePath);
                        if (!fs_1.default.existsSync(dir)) {
                            fs_1.default.mkdirSync(dir, { recursive: true });
                        }
                        fs_1.default.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Check if user is already logged in
     */
    AuthService.prototype.isLoggedIn = function (page) {
        return __awaiter(this, void 0, void 0, function () {
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, page.waitForSelector(this.config.successSelector, {
                                timeout: 5000
                            })];
                    case 1:
                        _b.sent();
                        return [2 /*return*/, true];
                    case 2:
                        _a = _b.sent();
                        return [2 /*return*/, false];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Authenticate the user
     * @returns true if authentication was successful
     */
    AuthService.prototype.authenticate = function (page) {
        return __awaiter(this, void 0, void 0, function () {
            var _a, loginUrl, successSelector, loginTimeout, hasCookies, error_2;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _a = this.config, loginUrl = _a.loginUrl, successSelector = _a.successSelector, loginTimeout = _a.loginTimeout;
                        return [4 /*yield*/, this.loadCookies(page)];
                    case 1:
                        hasCookies = _b.sent();
                        // Navigate to login page
                        return [4 /*yield*/, page.goto(loginUrl, { waitUntil: 'networkidle2' })];
                    case 2:
                        // Navigate to login page
                        _b.sent();
                        return [4 /*yield*/, this.isLoggedIn(page)];
                    case 3:
                        // Check if already logged in
                        if (_b.sent()) {
                            console.log('Successfully logged in using saved cookies');
                            return [2 /*return*/, true];
                        }
                        // Wait for manual login
                        console.log('Manual login required. Please log in manually...');
                        _b.label = 4;
                    case 4:
                        _b.trys.push([4, 7, , 8]);
                        return [4 /*yield*/, page.waitForSelector(successSelector, {
                                timeout: loginTimeout
                            })];
                    case 5:
                        _b.sent();
                        // Save new cookies after successful login
                        return [4 /*yield*/, this.saveCookies(page)];
                    case 6:
                        // Save new cookies after successful login
                        _b.sent();
                        console.log('Login successful. Cookies saved.');
                        return [2 /*return*/, true];
                    case 7:
                        error_2 = _b.sent();
                        console.error('Login timeout or failed:', error_2);
                        return [2 /*return*/, false];
                    case 8: return [2 /*return*/];
                }
            });
        });
    };
    return AuthService;
}());
exports.AuthService = AuthService;
