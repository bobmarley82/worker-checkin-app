export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          role: string;
          is_active: boolean;
          created_at: string | null;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          role?: string;
          is_active?: boolean;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          role?: string;
          is_active?: boolean;
          created_at?: string | null;
        };
        Relationships: [];
      };

      jobs: {
        Row: {
          id: string;
          name: string;
          is_active: boolean;
          created_by: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "jobs_created_by_fkey";
            columns: ["created_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };

checkins: {
  Row: {
    id: string;
    worker_name: string;
    job_id: string;
    checkin_date: string;
    injured: boolean;
    signature_data: string;
    signed_at: string | null;
    signed_out_at: string | null;
    auto_signed_out: boolean;
    created_at: string | null;
  };
  Insert: {
    id?: string;
    worker_name: string;
    job_id: string;
    checkin_date: string;
    injured?: boolean;
    signature_data: string;
    signed_at?: string | null;
    signed_out_at?: string | null;
    auto_signed_out?: boolean;
    created_at?: string | null;
  };
  Update: {
    id?: string;
    worker_name?: string;
    job_id?: string;
    checkin_date?: string;
    injured?: boolean;
    signature_data?: string;
    signed_at?: string | null;
    signed_out_at?: string | null;
    auto_signed_out?: boolean;
    created_at?: string | null;
  };
  Relationships: [
    {
      foreignKeyName: "checkins_job_id_fkey";
      columns: ["job_id"];
      referencedRelation: "jobs";
      referencedColumns: ["id"];
    }
  ];
};

workers: {
  Row: {
    id: string;
    name: string;
    is_active: boolean;
    created_at: string;
  };
  Insert: {
    id?: string;
    name: string;
    is_active?: boolean;
    created_at?: string;
  };
  Update: {
    id?: string;
    name?: string;
    is_active?: boolean;
    created_at?: string;
  };
  Relationships: [];
};

    };

    Views: {};

    Functions: {};

    Enums: {};

    CompositeTypes: {};
  };
};