export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      articles: {
        Row: {
          ai_model: string | null
          ai_prompt: string | null
          content: string
          created_at: string
          error_message: string | null
          excerpt: string
          featured_image_url: string | null
          id: string
          project_id: string
          published_at: string | null
          status: Database["public"]["Enums"]["article_status"]
          title: string
          wp_post_id: number | null
          wp_post_url: string | null
        }
        Insert: {
          ai_model?: string | null
          ai_prompt?: string | null
          content?: string
          created_at?: string
          error_message?: string | null
          excerpt?: string
          featured_image_url?: string | null
          id?: string
          project_id: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["article_status"]
          title?: string
          wp_post_id?: number | null
          wp_post_url?: string | null
        }
        Update: {
          ai_model?: string | null
          ai_prompt?: string | null
          content?: string
          created_at?: string
          error_message?: string | null
          excerpt?: string
          featured_image_url?: string | null
          id?: string
          project_id?: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["article_status"]
          title?: string
          wp_post_id?: number | null
          wp_post_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "articles_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          annual_price_cents: number | null
          created_at: string
          description: string
          features: Json
          is_popular: boolean
          key: string
          monthly_price_cents: number
          monthly_tokens: number
          name: string
          sort_order: number
          stripe_annual_price_id: string | null
          stripe_price_id: string | null
        }
        Insert: {
          annual_price_cents?: number | null
          created_at?: string
          description?: string
          features?: Json
          is_popular?: boolean
          key: string
          monthly_price_cents: number
          monthly_tokens: number
          name: string
          sort_order?: number
          stripe_annual_price_id?: string | null
          stripe_price_id?: string | null
        }
        Update: {
          annual_price_cents?: number | null
          created_at?: string
          description?: string
          features?: Json
          is_popular?: boolean
          key?: string
          monthly_price_cents?: number
          monthly_tokens?: number
          name?: string
          sort_order?: number
          stripe_annual_price_id?: string | null
          stripe_price_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          ai_prompt_template: string
          articles_per_day: number
          created_at: string
          id: string
          is_active: boolean
          keywords: string[]
          name: string
          niche: string
          schedule_cron: string
          slug: string
          updated_at: string
          user_id: string
          wp_app_password: string
          wp_url: string
          wp_username: string
        }
        Insert: {
          ai_prompt_template?: string
          articles_per_day?: number
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string[]
          name: string
          niche?: string
          schedule_cron?: string
          slug: string
          updated_at?: string
          user_id: string
          wp_app_password: string
          wp_url: string
          wp_username: string
        }
        Update: {
          ai_prompt_template?: string
          articles_per_day?: number
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string[]
          name?: string
          niche?: string
          schedule_cron?: string
          slug?: string
          updated_at?: string
          user_id?: string
          wp_app_password?: string
          wp_url?: string
          wp_username?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_customers: {
        Row: {
          created_at: string
          stripe_customer_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          stripe_customer_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          stripe_customer_id?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan_key: string
          status: string
          stripe_price_id: string
          stripe_subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_key: string
          status: string
          stripe_price_id: string
          stripe_subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_key?: string
          status?: string
          stripe_price_id?: string
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_key_fkey"
            columns: ["plan_key"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["key"]
          },
        ]
      }
      token_balances: {
        Row: {
          balance: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      token_packs: {
        Row: {
          created_at: string
          description: string
          key: string
          name: string
          price_cents: number
          sort_order: number
          stripe_price_id: string
          tokens: number
        }
        Insert: {
          created_at?: string
          description?: string
          key: string
          name: string
          price_cents: number
          sort_order?: number
          stripe_price_id: string
          tokens: number
        }
        Update: {
          created_at?: string
          description?: string
          key?: string
          name?: string
          price_cents?: number
          sort_order?: number
          stripe_price_id?: string
          tokens?: number
        }
        Relationships: []
      }
      token_transactions: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          id: string
          metadata: Json
          stripe_event_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          stripe_event_id?: string | null
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          stripe_event_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_tokens: {
        Args: { p_amount: number; p_description?: string; p_user_id: string }
        Returns: number
      }
      grant_tokens: {
        Args: {
          p_amount: number
          p_description?: string
          p_metadata?: Json
          p_stripe_event_id?: string
          p_type: string
          p_user_id: string
        }
        Returns: number
      }
      record_token_refund: {
        Args: {
          p_amount: number
          p_description?: string
          p_metadata?: Json
          p_stripe_event_id?: string
          p_user_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      article_status:
        | "draft"
        | "generating"
        | "ready"
        | "publishing"
        | "published"
        | "failed"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      article_status: [
        "draft",
        "generating",
        "ready",
        "publishing",
        "published",
        "failed",
      ],
    },
  },
} as const

