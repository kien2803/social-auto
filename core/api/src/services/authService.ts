/**
 * Copyright (c) 2026 Kien Nguyen
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { UsersRepo } from '../repositories/users.js';

const SALT_ROUNDS = 10;
const JWT_EXPIRES_IN = '7d';
// Compared against when the email doesn't exist, so a failed login takes
// ~the same time whether the account exists or not — otherwise the fast
// "user not found" return is a free user-enumeration timing oracle.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', SALT_ROUNDS);

export interface AuthTokens {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
}

export class AuthService {
  constructor(
    private usersRepo: UsersRepo,
    private jwtSecret: string,
  ) {}

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async register(email: string, password: string, name: string): Promise<AuthTokens> {
    // Check if user already exists
    const existingUser = this.usersRepo.findByEmail(email);
    if (existingUser) {
      throw new Error('Email already registered');
    }

    // Hash password
    const passwordHash = await this.hashPassword(password);

    // Create user
    const user = this.usersRepo.create({
      email,
      password_hash: passwordHash,
      name,
    });

    // Generate JWT token
    const token = this.generateToken(user.id);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    };
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    // Find user by email
    const user = this.usersRepo.findByEmail(email);
    // Get password hash
    const passwordHash = this.usersRepo.getPasswordHashByEmail(email);
    if (!user || !passwordHash) {
      await this.verifyPassword(password, DUMMY_HASH);
      throw new Error('Invalid email or password');
    }

    // Verify password
    const isValid = await this.verifyPassword(password, passwordHash);
    if (!isValid) {
      throw new Error('Invalid email or password');
    }

    // Generate JWT token
    const token = this.generateToken(user.id);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    };
  }

  verifyToken(token: string): { userId: string } {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as { userId: string };
      return { userId: decoded.userId };
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  private generateToken(userId: string): string {
    return jwt.sign({ userId }, this.jwtSecret, {
      expiresIn: JWT_EXPIRES_IN,
    });
  }

  getUserById(userId: string) {
    return this.usersRepo.findById(userId);
  }

  getPasswordHash(userId: string): string | null {
    return this.usersRepo.getPasswordHash(userId);
  }

  updatePassword(userId: string, passwordHash: string): void {
    this.usersRepo.updatePasswordHash(userId, passwordHash);
  }

  updateName(userId: string, name: string): void {
    this.usersRepo.updateName(userId, name);
  }

  deleteUser(userId: string): void {
    this.usersRepo.deleteById(userId);
  }
}
