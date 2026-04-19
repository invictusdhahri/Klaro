export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      anomaly_flags: {
        Row: {
          created_at: string
          description: string | null
          evidence: Json | null
          flag_type: string
          id: string
          resolution_status: string
          resolved_at: string | null
          severity: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          evidence?: Json | null
          flag_type: string
          id?: string
          resolution_status?: string
          resolved_at?: string | null
          severity: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          evidence?: Json | null
          flag_type?: string
          id?: string
          resolution_status?: string
          resolved_at?: string | null
          severity?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "anomaly_flags_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string
          actor_type: string
          created_at: string
          id: string
          ip_address: unknown
          metadata: Json | null
          resource_id: string | null
          resource_type: string | null
        }
        Insert: {
          action: string
          actor_id: string
          actor_type: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          resource_id?: string | null
          resource_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          actor_type?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          resource_id?: string | null
          resource_type?: string | null
        }
        Relationships: []
      }
      bank_api_keys: {
        Row: {
          bank_id: string
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          bank_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Update: {
          bank_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "bank_api_keys_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_connections: {
        Row: {
          account_count: number
          bank_id: string | null
          bank_name: string
          connection_method: string
          created_at: string
          id: string
          last_sync_at: string | null
          sync_status: string
          user_id: string
        }
        Insert: {
          account_count?: number
          bank_id?: string | null
          bank_name: string
          connection_method: string
          created_at?: string
          id?: string
          last_sync_at?: string | null
          sync_status?: string
          user_id: string
        }
        Update: {
          account_count?: number
          bank_id?: string | null
          bank_name?: string
          connection_method?: string
          created_at?: string
          id?: string
          last_sync_at?: string | null
          sync_status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_connections_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_consents: {
        Row: {
          bank_id: string
          consent_granted: boolean
          consent_scope: string[]
          granted_at: string | null
          id: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          bank_id: string
          consent_granted?: boolean
          consent_scope?: string[]
          granted_at?: string | null
          id?: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          bank_id?: string
          consent_granted?: boolean
          consent_scope?: string[]
          granted_at?: string | null
          id?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_consents_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statements: {
        Row: {
          anomaly_report: Json
          bank_id: string | null
          clarification_answers: Json
          clarification_questions: Json
          coherence_score: number | null
          created_at: string
          error_message: string | null
          extracted_count: number
          file_hash: string
          file_name: string
          id: string
          income_assessment: Json
          mime_type: string
          reasoning: Json
          risk_score: number | null
          status: string
          storage_path: string
          user_id: string
          verification_report: Json
        }
        Insert: {
          anomaly_report?: Json
          bank_id?: string | null
          clarification_answers?: Json
          clarification_questions?: Json
          coherence_score?: number | null
          created_at?: string
          error_message?: string | null
          extracted_count?: number
          file_hash: string
          file_name: string
          id?: string
          income_assessment?: Json
          mime_type: string
          reasoning?: Json
          risk_score?: number | null
          status?: string
          storage_path: string
          user_id: string
          verification_report?: Json
        }
        Update: {
          anomaly_report?: Json
          bank_id?: string | null
          clarification_answers?: Json
          clarification_questions?: Json
          coherence_score?: number | null
          created_at?: string
          error_message?: string | null
          extracted_count?: number
          file_hash?: string
          file_name?: string
          id?: string
          income_assessment?: Json
          mime_type?: string
          reasoning?: Json
          risk_score?: number | null
          status?: string
          storage_path?: string
          user_id?: string
          verification_report?: Json
        }
        Relationships: [
          {
            foreignKeyName: "bank_statements_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_users: {
        Row: {
          bank_id: string
          created_at: string
          role: string
          user_id: string
        }
        Insert: {
          bank_id: string
          created_at?: string
          role?: string
          user_id: string
        }
        Update: {
          bank_id?: string
          created_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_users_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
        ]
      }
      banks: {
        Row: {
          country: string
          created_at: string
          id: string
          logo_url: string | null
          name: string
          slug: string
        }
        Insert: {
          country?: string
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          slug: string
        }
        Update: {
          country?: string
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          context_snapshot: Json | null
          created_at: string
          id: string
          role: string
          session_id: string | null
          user_id: string
        }
        Insert: {
          content: string
          context_snapshot?: Json | null
          created_at?: string
          id?: string
          role: string
          session_id?: string | null
          user_id: string
        }
        Update: {
          content?: string
          context_snapshot?: Json | null
          created_at?: string
          id?: string
          role?: string
          session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sessions: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          is_summarized: boolean
          last_message_at: string | null
          message_count: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_summarized?: boolean
          last_message_at?: string | null
          message_count?: number
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_summarized?: boolean
          last_message_at?: string | null
          message_count?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_scores: {
        Row: {
          breakdown: Json
          confidence: number | null
          created_at: string
          data_gaps: Json
          data_sufficiency: number | null
          feature_importance: Json
          flags: Json
          id: string
          model_version: string
          recommendations: Json
          risk_category: string | null
          score: number
          score_band: string | null
          user_id: string
        }
        Insert: {
          breakdown?: Json
          confidence?: number | null
          created_at?: string
          data_gaps?: Json
          data_sufficiency?: number | null
          feature_importance?: Json
          flags?: Json
          id?: string
          model_version: string
          recommendations?: Json
          risk_category?: string | null
          score: number
          score_band?: string | null
          user_id: string
        }
        Update: {
          breakdown?: Json
          confidence?: number | null
          created_at?: string
          data_gaps?: Json
          data_sufficiency?: number | null
          feature_importance?: Json
          flags?: Json
          id?: string
          model_version?: string
          recommendations?: Json
          risk_category?: string | null
          score?: number
          score_band?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_scores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      kyc_documents: {
        Row: {
          authenticity_score: number | null
          consistency_score: number | null
          created_at: string
          deepfake_score: number | null
          document_hash: string
          document_type: string
          id: string
          ocr_data: Json | null
          storage_path: string
          user_id: string
          verification_status: string
        }
        Insert: {
          authenticity_score?: number | null
          consistency_score?: number | null
          created_at?: string
          deepfake_score?: number | null
          document_hash: string
          document_type: string
          id?: string
          ocr_data?: Json | null
          storage_path: string
          user_id: string
          verification_status?: string
        }
        Update: {
          authenticity_score?: number | null
          consistency_score?: number | null
          created_at?: string
          deepfake_score?: number | null
          document_hash?: string
          document_type?: string
          id?: string
          ocr_data?: Json | null
          storage_path?: string
          user_id?: string
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "kyc_documents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          date_of_birth: string | null
          education_level: string | null
          full_name: string
          id: string
          kyc_status: string
          location_country: string | null
          location_governorate: string | null
          occupation: string | null
          occupation_category: string | null
          phone: string | null
          profile_context: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_of_birth?: string | null
          education_level?: string | null
          full_name: string
          id: string
          kyc_status?: string
          location_country?: string | null
          location_governorate?: string | null
          occupation?: string | null
          occupation_category?: string | null
          phone?: string | null
          profile_context?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_of_birth?: string | null
          education_level?: string | null
          full_name?: string
          id?: string
          kyc_status?: string
          location_country?: string | null
          location_governorate?: string | null
          occupation?: string | null
          occupation_category?: string | null
          phone?: string | null
          profile_context?: Json
          updated_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          bank_connection_id: string | null
          bank_id: string | null
          category: string | null
          counterparty: string | null
          created_at: string
          currency: string
          description: string | null
          id: string
          source: string
          statement_id: string | null
          transaction_date: string
          transaction_type: string
          user_id: string
        }
        Insert: {
          amount: number
          bank_connection_id?: string | null
          bank_id?: string | null
          category?: string | null
          counterparty?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          source: string
          statement_id?: string | null
          transaction_date: string
          transaction_type: string
          user_id: string
        }
        Update: {
          amount?: number
          bank_connection_id?: string | null
          bank_id?: string | null
          category?: string | null
          counterparty?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          source?: string
          statement_id?: string | null
          transaction_date?: string
          transaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_bank_connection_id_fkey"
            columns: ["bank_connection_id"]
            isOneToOne: false
            referencedRelation: "bank_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "bank_statements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_memories: {
        Row: {
          category: string | null
          created_at: string
          fact: string
          id: string
          importance: number
          source_session_id: string | null
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          fact: string
          id?: string
          importance?: number
          source_session_id?: string | null
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          fact?: string
          id?: string
          importance?: number
          source_session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_memories_source_session_id_fkey"
            columns: ["source_session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_memories_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_bank_id: { Args: never; Returns: string }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_bank_clients: {
        Args: { p_bank_id: string }
        Returns: {
          consent_scope: string[]
          full_name: string
          granted_at: string
          kyc_status: string
          score: number
          score_band: string
          user_id: string
        }[]
      }
      get_bank_dashboard_stats: { Args: { p_bank_id: string }; Returns: Json }
      has_role: {
        Args: { target: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "user" | "bank" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["user", "bank", "admin"],
    },
  },
} as const

