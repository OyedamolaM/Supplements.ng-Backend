const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { prisma, newId, fromDbUserRole, toDbUserRole } = require("../utils/prismaLegacy");
const {
  sendBrevoEmail,
  buildVerificationEmail,
  buildPasswordResetEmail,
  buildWelcomeEmail,
  buildSignupNotificationEmail,
  getSignupNotificationRecipient,
} = require("../services/emailService");
const appleSigninAuth = require("apple-signin-auth");
const {
  isUserDeactivated,
  isReactivationWindowOpen,
  buildAccountDeactivationResponse,
  reactivateUserAccount,
} = require("../services/accountLifecycleService");

const toTitleCase = (value = '') =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const ACCESS_TTL = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_TTL = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
const ACCESS_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
const EMAIL_VERIFICATION_TTL_MINUTES = Number(process.env.EMAIL_VERIFICATION_TTL_MINUTES || 15);
const PASSWORD_RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES || 15);
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const APPLE_CLIENT_ID = (process.env.APPLE_CLIENT_ID || "").trim();
const IS_PROD = process.env.NODE_ENV === 'production';
const EXPOSE_AUTH_DEBUG_CODES =
  !IS_PROD && (process.env.EXPOSE_AUTH_DEBUG_CODES || "").toString().trim() === "true";

const generateVerificationCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const generateResetCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const authDebugCode = (code) => (EXPOSE_AUTH_DEBUG_CODES ? code : undefined);

const createVerificationCode = async (user) => {
  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MINUTES * 60 * 1000);
  const hashedCode = await bcrypt.hash(code, 10);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: false,
      emailVerifiedAt: null,
      emailVerificationCode: hashedCode,
      emailVerificationExpiresAt: expiresAt,
    },
  });

  return code;
};

const sendVerificationEmail = async (user, code) => {
  const { subject, text, html } = buildVerificationEmail({
    name: user.name || "there",
    code,
    expiresInMinutes: EMAIL_VERIFICATION_TTL_MINUTES,
  });

  await sendBrevoEmail({
    to: user.email,
    subject,
    text,
    html,
    senderKey: "otp",
  });
};

const issueVerificationCode = async (user) => {
  const code = await createVerificationCode(user);
  await sendVerificationEmail(user, code);
  return code;
};

const clearRefreshCookie = (res) => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth/refresh',
  });
};

const buildAuthPayload = (user) => {
  const role = fromDbUserRole(user.role);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role,
    isAdmin: role === "admin" || role === "super_admin",
  };
};

const issuePasswordResetCode = async (user) => {
  const code = generateResetCode();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
  const hashedCode = await bcrypt.hash(code, 10);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetCode: hashedCode,
      passwordResetExpiresAt: expiresAt,
    },
  });

  const { subject, text, html } = buildPasswordResetEmail({
    name: user.name || "there",
    code,
    expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
  });

  await sendBrevoEmail({
    to: user.email,
    subject,
    text,
    html,
    senderKey: "otp",
  });

  return code;
};

const queueWelcomeEmail = (user) => {
  if (!user?.email) return;
  const welcomeEmail = buildWelcomeEmail({ name: user.name || "there" });
  sendBrevoEmail({
    to: user.email,
    subject: welcomeEmail.subject,
    text: welcomeEmail.text,
    html: welcomeEmail.html,
    senderKey: "welcome",
  }).catch((err) => console.error("Failed to send welcome email", err));
};

const queueSupportSignupEmail = (user, signupMethod = "email") => {
  if (!user?.email) return;

  const recipient = getSignupNotificationRecipient();
  if (!recipient) return;

  Promise.resolve()
    .then(async () => {
      const totalCustomers = await prisma.user.count({
        where: {
          role: toDbUserRole("customer"),
          accountPurgedAt: null,
        },
      });
      const notification = buildSignupNotificationEmail({
        name: user.name || "Customer",
        email: user.email,
        phone: user.phone || "",
        signupMethod,
        userId: user.id,
        createdAt: user.createdAt || new Date(),
        totalCustomers,
      });

      await sendBrevoEmail({
        to: recipient,
        subject: notification.subject,
        text: notification.text,
        html: notification.html,
        senderKey: "support",
      });
    })
    .catch((err) => console.error("Failed to send support signup email", err));
};

const signAccessToken = (id) =>
  jwt.sign({ id }, ACCESS_SECRET, {
    expiresIn: ACCESS_TTL,
  });

const signRefreshToken = (id) =>
  jwt.sign({ id }, REFRESH_SECRET, {
    expiresIn: REFRESH_TTL,
  });

const setRefreshCookie = (res, token) => {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/api/auth/refresh',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

// Register new user
exports.register = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      gender,
      dateOfBirth,
      assignedPharmacistName,
    } = req.body;
    if (!name || !email || !password || !phone) {
      return res.status(400).json({ message: 'Please provide all fields' });
    }

    const normalizedEmail = email.toString().trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        id: newId(),
        role: toDbUserRole("customer"),
        password: hashedPassword,
        email: normalizedEmail,
        phone: phone.toString().trim(),
        region: "",
        branchId: null,
        name: toTitleCase(name),
        gender: gender ? gender.toString().trim() : "",
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
        assignedPharmacistName: assignedPharmacistName ? assignedPharmacistName.toString().trim() : "",
        emailVerified: false,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
      },
    });

    queueSupportSignupEmail(user, "email");

    let debugCode = null;
    try {
      debugCode = await issueVerificationCode(user);
    } catch (err) {
      console.error("Failed to send verification email", err);
    }

    res.status(201).json({
      message: "Account created. Please verify your email.",
      requiresEmailVerification: true,
      email: user.email,
      verificationChannel: "email",
      debugCode: authDebugCode(debugCode),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Login user
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    const normalizedEmail = email.toString().trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        password: true,
        role: true,
        branchId: true,
        emailVerified: true,
        emailVerificationExpiresAt: true,
        deactivatedAt: true,
        accountDeletionScheduledFor: true,
        accountPurgedAt: true,
      },
    });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    if (isUserDeactivated(user)) {
      if (isReactivationWindowOpen(user)) {
        const reactivatedUser = await reactivateUserAccount(user.id);
        user.deactivatedAt = reactivatedUser.deactivatedAt;
        user.accountDeletionScheduledFor = reactivatedUser.accountDeletionScheduledFor;
      } else {
        return res.status(403).json(buildAccountDeactivationResponse(user));
      }
    }

    if (!user.emailVerified) {
      let debugCode = null;
      try {
        debugCode = await issueVerificationCode(user);
      } catch (err) {
        console.error("Failed to resend verification email", err);
      }
      return res.status(403).json({
        message: "Please verify your email to continue.",
        requiresEmailVerification: true,
        email: user.email,
        verificationChannel: "email",
        debugCode: authDebugCode(debugCode),
      });
    }

    prisma.activityLog
      .create({
        data: {
          id: newId(),
          userId: user.id,
          action: "login",
          entityType: "auth",
          branchId: user.branchId || null,
          message: "User signed in",
        },
      })
      .catch(() => null);

    const refreshToken = signRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);

    res.json({
      ...buildAuthPayload(user),
      accessToken: signAccessToken(user.id),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Refresh access token using HttpOnly cookie
exports.refresh = async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) return res.status(401).json({ message: 'No refresh token' });

  try {
    const decoded = jwt.verify(token, REFRESH_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        emailVerified: true,
        deactivatedAt: true,
        accountDeletionScheduledFor: true,
        accountPurgedAt: true,
      },
    });
    if (!user) return res.status(401).json({ message: 'User not found' });
    if (isUserDeactivated(user)) {
      clearRefreshCookie(res);
      return res.status(403).json(buildAccountDeactivationResponse(user));
    }
    if (!user.emailVerified) {
      return res.status(403).json({
        message: "Please verify your email to continue.",
        requiresEmailVerification: true,
        email: user.email,
      });
    }

    const newRefresh = signRefreshToken(user.id);
    setRefreshCookie(res, newRefresh);

    res.json({
      accessToken: signAccessToken(user.id),
      user: buildAuthPayload(user),
    });
  } catch (err) {
    console.error(err);
    res.status(401).json({ message: 'Invalid refresh token' });
  }
};

// Logout: clear cookie
exports.logout = (_req, res) => {
  clearRefreshCookie(res);
  res.status(204).send();
};

const verifyGoogleIdToken = async (idToken) => {
  const endpoint = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(`Invalid Google token: ${body || response.status}`);
    (error as any).status = 401;
    throw error;
  }
  const data = await response.json();
  if (GOOGLE_CLIENT_ID && data.aud !== GOOGLE_CLIENT_ID) {
    const error = new Error("Google token audience mismatch.");
    (error as any).status = 401;
    throw error;
  }
  if (!data.email || data.email_verified !== "true") {
    const error = new Error("Google email not verified.");
    (error as any).status = 401;
    throw error;
  }
  return data;
};

const verifyAppleIdToken = async (idToken) => {
  if (!APPLE_CLIENT_ID) {
    const error = new Error("Apple client id not configured.");
    (error as any).status = 500;
    throw error;
  }

  try {
    const payload = await appleSigninAuth.verifyIdToken(idToken, {
      audience: APPLE_CLIENT_ID,
      ignoreExpiration: false,
    });

    if (!payload?.sub) {
      const error = new Error("Invalid Apple token.");
      (error as any).status = 401;
      throw error;
    }

    return payload;
  } catch (err: any) {
    const error = new Error(err?.message || "Invalid Apple token.");
    (error as any).status = 401;
    throw error;
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ message: "Please provide email and code" });
    }

    const normalizedEmail = email.toString().trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        emailVerified: true,
        emailVerificationCode: true,
        emailVerificationExpiresAt: true,
      },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid verification details" });
    }

    if (user.emailVerified) {
      return res.json({
        accessToken: signAccessToken(user.id),
        user: buildAuthPayload(user),
        message: "Email already verified.",
      });
    }

    if (!user.emailVerificationCode) {
      return res.status(400).json({ message: "Verification code expired. Please resend." });
    }

    const expired =
      user.emailVerificationExpiresAt &&
      new Date(user.emailVerificationExpiresAt).getTime() < Date.now();
    if (expired) {
      return res.status(400).json({ message: "Verification code expired. Please resend." });
    }

    const isValid = await bcrypt.compare(code.toString().trim(), user.emailVerificationCode);
    if (!isValid) {
      return res.status(400).json({ message: "Invalid verification code" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
        emailVerificationCode: "",
        emailVerificationExpiresAt: null,
      },
    });

    queueWelcomeEmail(user);

    res.json({
      accessToken: signAccessToken(user.id),
      user: buildAuthPayload(user),
      message: "Email verified successfully.",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.resendVerification = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({
        message: "Please provide email. Verification codes are sent by email only.",
      });
    }

    const normalizedEmail = email.toString().trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        emailVerified: true,
      },
    });

    if (!user) {
      return res.status(200).json({ message: "If that email exists, a new code has been sent." });
    }

    if (user.emailVerified) {
      return res.status(200).json({ message: "Email already verified." });
    }

    let debugCode = null;
    try {
      debugCode = await issueVerificationCode(user);
    } catch (err) {
      console.error("Failed to send verification email", err);
      return res.status(500).json({
        message: "Unable to send verification code. Please try again.",
      });
    }

    res.json({
      message: "A new verification code has been sent to your email.",
      verificationChannel: "email",
      debugCode: authDebugCode(debugCode),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Please provide email" });
    }

    const normalizedEmail = email.toString().trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, name: true, email: true },
    });

    if (!user) {
      return res.status(200).json({
        message: "If that email exists, a reset code has been sent.",
      });
    }

    let debugCode = null;
    try {
      debugCode = await issuePasswordResetCode(user);
    } catch (err) {
      console.error("Failed to send password reset email", err);
    }

    res.json({
      message: "If that email exists, a reset code has been sent.",
      debugCode: authDebugCode(debugCode),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, code, password } = req.body;
    if (!email || !code || !password) {
      return res.status(400).json({ message: "Email, code, and new password are required" });
    }

    const normalizedEmail = email.toString().trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        passwordResetCode: true,
        passwordResetExpiresAt: true,
      },
    });

    if (!user || !user.passwordResetCode) {
      return res.status(400).json({ message: "Invalid reset details" });
    }

    const expired =
      user.passwordResetExpiresAt &&
      new Date(user.passwordResetExpiresAt).getTime() < Date.now();
    if (expired) {
      return res.status(400).json({ message: "Reset code expired. Please request a new one." });
    }

    const isValid = await bcrypt.compare(code.toString().trim(), user.passwordResetCode);
    if (!isValid) {
      return res.status(400).json({ message: "Invalid reset code" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordChangedAt: new Date(),
        passwordResetCode: "",
        passwordResetExpiresAt: null,
      },
    });

    res.json({ message: "Password reset successful." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.googleAuth = async (req, res) => {
  try {
    const credential = req.body?.credential || req.body?.idToken;
    if (!credential) {
      return res.status(400).json({ message: "Missing Google credential" });
    }

    const payload = await verifyGoogleIdToken(credential.toString().trim());
    const email = payload.email.toString().trim().toLowerCase();
    const name = toTitleCase(payload.name || payload.given_name || payload.family_name || "Customer");
    const avatar = (payload.picture || "").toString().trim();

    let user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        branchId: true,
        emailVerified: true,
        emailVerifiedAt: true,
        avatarUrl: true,
        deactivatedAt: true,
        accountDeletionScheduledFor: true,
        accountPurgedAt: true,
      },
    });

    let shouldSendWelcomeEmail = false;
    let shouldSendSupportSignupEmail = false;

    if (!user) {
      const randomPassword = await bcrypt.hash(newId(), 10);
      user = await prisma.user.create({
        data: {
          id: newId(),
          role: toDbUserRole("customer"),
          password: randomPassword,
          email,
          phone: "",
          region: "",
          branchId: null,
          name,
          gender: "",
          assignedPharmacistName: "",
          emailVerified: true,
          emailVerifiedAt: new Date(),
          avatarUrl: avatar,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          branchId: true,
          emailVerified: true,
          emailVerifiedAt: true,
          avatarUrl: true,
          deactivatedAt: true,
          accountDeletionScheduledFor: true,
          accountPurgedAt: true,
          createdAt: true,
        },
      });
      shouldSendWelcomeEmail = true;
      shouldSendSupportSignupEmail = true;
    } else {
      const updates: Record<string, any> = {};
      if (!user.emailVerified) {
        updates.emailVerified = true;
        updates.emailVerifiedAt = new Date();
        shouldSendWelcomeEmail = true;
      }
      if (!user.name && name) updates.name = name;
      if (!user.avatarUrl && avatar) updates.avatarUrl = avatar;

      if (Object.keys(updates).length) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: updates,
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
            branchId: true,
            emailVerified: true,
            emailVerifiedAt: true,
            avatarUrl: true,
            deactivatedAt: true,
            accountDeletionScheduledFor: true,
            accountPurgedAt: true,
          },
        });
      }
    }

    if (isUserDeactivated(user)) {
      if (isReactivationWindowOpen(user)) {
        const reactivatedUser = await reactivateUserAccount(user.id);
        user.deactivatedAt = reactivatedUser.deactivatedAt;
        user.accountDeletionScheduledFor = reactivatedUser.accountDeletionScheduledFor;
        user.accountPurgedAt = reactivatedUser.accountPurgedAt;
      } else {
        return res.status(403).json(buildAccountDeactivationResponse(user));
      }
    }

    if (shouldSendWelcomeEmail) {
      queueWelcomeEmail(user);
    }
    if (shouldSendSupportSignupEmail) {
      queueSupportSignupEmail(user, "google");
    }

    prisma.activityLog
      .create({
        data: {
          id: newId(),
          userId: user.id,
          action: "login",
          entityType: "auth",
          branchId: user.branchId || null,
          message: "User signed in with Google",
        },
      })
      .catch(() => null);

    const refreshToken = signRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);

    res.json({
      ...buildAuthPayload(user),
      accessToken: signAccessToken(user.id),
    });
  } catch (error) {
    console.error(error);
    res.status(error?.status || 500).json({ message: error.message || "Google auth failed" });
  }
};

exports.appleAuth = async (req, res) => {
  try {
    const idToken = req.body?.idToken || req.body?.credential;
    if (!idToken) {
      return res.status(400).json({ message: "Missing Apple credential" });
    }

    const payload = await verifyAppleIdToken(idToken.toString().trim());
    const appleSubject = payload.sub?.toString();
    const email = payload.email ? payload.email.toString().trim().toLowerCase() : "";

    const bodyName =
      req.body?.name ||
      [req.body?.firstName, req.body?.lastName].filter(Boolean).join(" ") ||
      [req.body?.givenName, req.body?.familyName].filter(Boolean).join(" ") ||
      [
        req.body?.user?.name?.firstName,
        req.body?.user?.name?.lastName,
      ]
        .filter(Boolean)
        .join(" ");
    const name = toTitleCase(bodyName || "Customer");

    let user = null;
    if (appleSubject) {
      user = await prisma.user.findUnique({
        where: { appleSubject },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          branchId: true,
          emailVerified: true,
          emailVerifiedAt: true,
          avatarUrl: true,
          appleSubject: true,
          deactivatedAt: true,
          accountDeletionScheduledFor: true,
          accountPurgedAt: true,
        },
      });
    }

    if (!user && email) {
      user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          branchId: true,
          emailVerified: true,
          emailVerifiedAt: true,
          avatarUrl: true,
          appleSubject: true,
        },
      });
    }

    let shouldSendWelcomeEmail = false;
    let shouldSendSupportSignupEmail = false;

    if (!user) {
      if (!email) {
        return res.status(400).json({
          message:
            "Apple sign in did not return an email. Please use email login once to link your Apple account.",
        });
      }
      const randomPassword = await bcrypt.hash(newId(), 10);
      user = await prisma.user.create({
        data: {
          id: newId(),
          role: toDbUserRole("customer"),
          password: randomPassword,
          email,
          phone: "",
          region: "",
          branchId: null,
          name,
          gender: "",
          assignedPharmacistName: "",
          emailVerified: true,
          emailVerifiedAt: new Date(),
          appleSubject,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          branchId: true,
          emailVerified: true,
          emailVerifiedAt: true,
          avatarUrl: true,
          appleSubject: true,
          deactivatedAt: true,
          accountDeletionScheduledFor: true,
          accountPurgedAt: true,
          createdAt: true,
        },
      });
      shouldSendWelcomeEmail = true;
      shouldSendSupportSignupEmail = true;
    } else {
      const updates: Record<string, any> = {};
      if (appleSubject && !user.appleSubject) updates.appleSubject = appleSubject;
      if (!user.emailVerified) {
        updates.emailVerified = true;
        updates.emailVerifiedAt = new Date();
        shouldSendWelcomeEmail = true;
      }
      if (!user.name && name) updates.name = name;

      if (Object.keys(updates).length) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: updates,
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
            branchId: true,
            emailVerified: true,
            emailVerifiedAt: true,
            avatarUrl: true,
            appleSubject: true,
            deactivatedAt: true,
            accountDeletionScheduledFor: true,
            accountPurgedAt: true,
          },
        });
      }
    }

    if (isUserDeactivated(user)) {
      if (isReactivationWindowOpen(user)) {
        const reactivatedUser = await reactivateUserAccount(user.id);
        user.deactivatedAt = reactivatedUser.deactivatedAt;
        user.accountDeletionScheduledFor = reactivatedUser.accountDeletionScheduledFor;
        user.accountPurgedAt = reactivatedUser.accountPurgedAt;
      } else {
        return res.status(403).json(buildAccountDeactivationResponse(user));
      }
    }

    if (shouldSendWelcomeEmail) {
      queueWelcomeEmail(user);
    }
    if (shouldSendSupportSignupEmail) {
      queueSupportSignupEmail(user, "apple");
    }

    prisma.activityLog
      .create({
        data: {
          id: newId(),
          userId: user.id,
          action: "login",
          entityType: "auth",
          branchId: user.branchId || null,
          message: "User signed in with Apple",
        },
      })
      .catch(() => null);

    const refreshToken = signRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);

    res.json({
      ...buildAuthPayload(user),
      accessToken: signAccessToken(user.id),
    });
  } catch (error: any) {
    console.error(error);
    res.status(error?.status || 500).json({ message: error.message || "Apple auth failed" });
  }
};
