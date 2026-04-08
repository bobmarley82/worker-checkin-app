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
          job_number: string | null;
          location_address: string | null;
          location_city: string | null;
          location_zip: string | null;
          is_active: boolean;
          created_by: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          job_number?: string | null;
          location_address?: string | null;
          location_city?: string | null;
          location_zip?: string | null;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          job_number?: string | null;
          location_address?: string | null;
          location_city?: string | null;
          location_zip?: string | null;
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

      admin_job_assignments: {
        Row: {
          admin_id: string;
          job_id: string;
          assigned_at: string;
          assigned_by: string | null;
        };
        Insert: {
          admin_id: string;
          job_id: string;
          assigned_at?: string;
          assigned_by?: string | null;
        };
        Update: {
          admin_id?: string;
          job_id?: string;
          assigned_at?: string;
          assigned_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "admin_job_assignments_admin_id_fkey";
            columns: ["admin_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "admin_job_assignments_assigned_by_fkey";
            columns: ["assigned_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "admin_job_assignments_job_id_fkey";
            columns: ["job_id"];
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          }
        ];
      };

      checkins: {
        Row: {
          id: string;
          worker_name: string;
          job_id: string;
          job_name: string | null;
          job_number: string | null;
          checkin_date: string;
          injured: boolean;
          signature_data: string;
          signout_signature_data: string | null;
          signed_at: string | null;
          signed_out_at: string | null;
          auto_signed_out: boolean;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          worker_name: string;
          job_id: string;
          job_name?: string | null;
          job_number?: string | null;
          checkin_date: string;
          injured?: boolean;
          signature_data: string;
          signout_signature_data?: string | null;
          signed_at?: string | null;
          signed_out_at?: string | null;
          auto_signed_out?: boolean;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          worker_name?: string;
          job_id?: string;
          job_name?: string | null;
          job_number?: string | null;
          checkin_date?: string;
          injured?: boolean;
          signature_data?: string;
          signout_signature_data?: string | null;
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

      daily_reports: {
        Row: {
          id: string;
          job_id: string;
          job_number: string | null;
          job_name: string;
          report_date: string;
          admin_id: string;
          admin_name: string;
          worker_count_source: string;
          worker_count: number;
          total_hours: number;
          worker_summary: Json | null;
          work_performed: string;
          issues: Json;
          safety_checklist: Json;
          inspections_received: string | null;
          equipment_notes: string | null;
          material_delivery: string | null;
          manpower_notes: string | null;
          photo_data: Json;
          weather_snapshot: Json | null;
          signature_data: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          job_id: string;
          job_number?: string | null;
          job_name: string;
          report_date: string;
          admin_id: string;
          admin_name: string;
          worker_count_source: string;
          worker_count: number;
          total_hours?: number;
          worker_summary?: Json | null;
          work_performed: string;
          issues?: Json;
          safety_checklist?: Json;
          inspections_received?: string | null;
          equipment_notes?: string | null;
          material_delivery?: string | null;
          manpower_notes?: string | null;
          photo_data?: Json;
          weather_snapshot?: Json | null;
          signature_data: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          job_id?: string;
          job_number?: string | null;
          job_name?: string;
          report_date?: string;
          admin_id?: string;
          admin_name?: string;
          worker_count_source?: string;
          worker_count?: number;
          total_hours?: number;
          worker_summary?: Json | null;
          work_performed?: string;
          issues?: Json;
          safety_checklist?: Json;
          inspections_received?: string | null;
          equipment_notes?: string | null;
          material_delivery?: string | null;
          manpower_notes?: string | null;
          photo_data?: Json;
          weather_snapshot?: Json | null;
          signature_data?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "daily_reports_admin_id_fkey";
            columns: ["admin_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_reports_job_id_fkey";
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

    Views: Record<string, never>;

    Functions: {
      sign_out_worker: {
        Args: {
          p_job_id: string;
          p_worker_name: string;
          p_injured: boolean;
          p_signout_signature_data: string;
        };
        Returns: string;
      };
    };

    Enums: Record<string, never>;

    CompositeTypes: Record<string, never>;
  };
};
