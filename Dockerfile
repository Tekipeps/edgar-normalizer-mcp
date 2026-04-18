# Use the official Bun image as the base image
FROM oven/bun:1.3.11 AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies (production only)
RUN bun install --production

# Copy source code
COPY . .

# Build the application
RUN bun run compile

# Production stage
FROM oven/bun:1.3.11-slim

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN addgroup --system app && adduser --system --ingroup app app

# Copy the compiled binary from builder stage
COPY --from=builder /app/dist/server ./server

# Change ownership to non-root user
RUN chown app:app ./server

# Switch to non-root user
USER app

# Expose port
EXPOSE 3001

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Run the server
CMD ["./server"]