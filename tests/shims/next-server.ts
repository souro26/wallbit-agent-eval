export class NextResponse extends Response {
  static json(data: unknown, init?: ResponseInit): Response {
    return Response.json(data, init);
  }
}

export type NextRequest = Request;
